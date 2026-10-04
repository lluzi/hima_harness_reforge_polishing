// emap_window: map one combinational window (AIGER) to standard cells with mockturtle's emap.
//
//   emap_window --genlib <lib.genlib> --aig <window.aig> --out <mapped.v> --module <name>
//               [--multioutput] [--area] [--all-sizes] [--arrivals <file>] [--names <file>]
//               [--stats <json>] [--verbose]
//
// Delay-oriented by default (emap then recovers area under the best delay). --multioutput lets emap
// use multi-output cells (genlib: repeated GATE lines with the same cell name, one per output pin,
// e.g. sky130_fd_sc_hd__fa_1 COUT/SUM). --area switches to area-oriented mapping.
// --all-sizes loads every drive strength (default: the smallest size of each function only; ORFS
// resizes the netlist later anyway).
//
// --arrivals: one number per line (ns), one line per AIGER input in AIGER input order; becomes
//   emap_params::arrival_times. Lines starting with '#' are ignored.
// --names: lines "i <k> <name>" and "o <k> <name>" (k = AIGER input/output index, 0-based); names
//   must be plain Verilog identifiers. Without it the ports are pi<k> / po<k>.
//
// The Verilog writer is local (not mockturtle's write_verilog_with_cell) so that outputs driven
// directly by an input or a constant, and outputs sharing one driver, are written as plain assigns.
// Exit codes: 0 ok, 2 usage, 3 input error, 4 mapping error.
#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include <lorina/aiger.hpp>
#include <lorina/genlib.hpp>
#include <mockturtle/algorithms/emap.hpp>
#include <mockturtle/io/aiger_reader.hpp>
#include <mockturtle/io/genlib_reader.hpp>
#include <mockturtle/networks/aig.hpp>
#include <mockturtle/networks/block.hpp>
#include <mockturtle/utils/tech_library.hpp>
#include <mockturtle/views/cell_view.hpp>

using namespace mockturtle;

namespace
{

struct options
{
  std::string genlib, aig, out, module, arrivals, names, stats;
  bool multioutput = false, area = false, all_sizes = false, verbose = false;
};

[[noreturn]] void die( int code, std::string const& msg )
{
  std::cerr << "emap_window: " << msg << "\n";
  std::exit( code );
}

void usage()
{
  std::cerr << "usage: emap_window --genlib <lib.genlib> --aig <window.aig> --out <mapped.v> --module <name>\n"
               "                   [--multioutput] [--area] [--all-sizes] [--arrivals <file>] [--names <file>]\n"
               "                   [--stats <json>] [--verbose]\n";
  std::exit( 2 );
}

options parse( int argc, char** argv )
{
  options o;
  for ( int i = 1; i < argc; ++i )
  {
    std::string a = argv[i];
    auto value = [&]() -> std::string {
      if ( i + 1 >= argc )
        usage();
      return argv[++i];
    };
    if ( a == "--genlib" ) o.genlib = value();
    else if ( a == "--aig" ) o.aig = value();
    else if ( a == "--out" ) o.out = value();
    else if ( a == "--module" ) o.module = value();
    else if ( a == "--arrivals" ) o.arrivals = value();
    else if ( a == "--names" ) o.names = value();
    else if ( a == "--stats" ) o.stats = value();
    else if ( a == "--multioutput" ) o.multioutput = true;
    else if ( a == "--area" ) o.area = true;
    else if ( a == "--all-sizes" ) o.all_sizes = true;
    else if ( a == "--verbose" ) o.verbose = true;
    else if ( a == "-h" || a == "--help" ) usage();
    else die( 2, "unknown argument " + a );
  }
  if ( o.genlib.empty() || o.aig.empty() || o.out.empty() || o.module.empty() )
    usage();
  return o;
}

bool plain_identifier( std::string const& s )
{
  static const std::regex re( "^[A-Za-z_][A-Za-z0-9_$]*$" );
  return std::regex_match( s, re );
}

std::string json_escape( std::string const& s )
{
  std::string r;
  for ( char c : s )
  {
    if ( c == '"' || c == '\\' ) { r += '\\'; r += c; }
    else if ( c == '\n' ) r += "\\n";
    else r += c;
  }
  return r;
}

} // namespace

int main( int argc, char** argv )
{
  auto const t0 = std::chrono::steady_clock::now();
  options const opt = parse( argc, argv );
  if ( !plain_identifier( opt.module ) )
    die( 2, "--module must be a plain Verilog identifier" );

  /* library */
  std::vector<gate> gates;
  {
    std::ifstream in( opt.genlib );
    if ( !in )
      die( 3, "cannot read genlib " + opt.genlib );
    if ( lorina::read_genlib( in, genlib_reader( gates ) ) != lorina::return_code::success )
      die( 3, "genlib parse error in " + opt.genlib );
  }
  if ( gates.empty() )
    die( 3, "genlib has no gates" );
  tech_library_params tps;
  tps.load_multioutput_gates = opt.multioutput;
  tps.load_multioutput_gates_single = false;
  tps.load_minimum_size_only = !opt.all_sizes;
  tps.remove_dominated_gates = !opt.all_sizes;
  tps.verbose = opt.verbose;
  tech_library<6, classification_type::np_configurations> lib( gates, tps );

  /* window */
  aig_network aig;
  if ( lorina::read_aiger( opt.aig, aiger_reader( aig ) ) != lorina::return_code::success )
    die( 3, "AIGER parse error in " + opt.aig );
  if ( !aig.is_combinational() )
    die( 3, "the window must be combinational (AIGER has latches)" );
  uint32_t const npi = aig.num_pis(), npo = aig.num_pos();

  std::vector<std::string> in_names( npi ), out_names( npo );
  for ( uint32_t k = 0; k < npi; ++k ) in_names[k] = "pi" + std::to_string( k );
  for ( uint32_t k = 0; k < npo; ++k ) out_names[k] = "po" + std::to_string( k );
  if ( !opt.names.empty() )
  {
    std::ifstream in( opt.names );
    if ( !in )
      die( 3, "cannot read names file " + opt.names );
    std::string line;
    while ( std::getline( in, line ) )
    {
      if ( line.empty() || line[0] == '#' ) continue;
      std::istringstream ls( line );
      std::string kind, name;
      uint32_t k;
      if ( !( ls >> kind >> k >> name ) || ( kind != "i" && kind != "o" ) )
        die( 3, "bad names line: " + line );
      if ( !plain_identifier( name ) )
        die( 3, "name is not a plain Verilog identifier: " + name );
      auto& vec = kind == "i" ? in_names : out_names;
      if ( k >= vec.size() )
        die( 3, "names index out of range: " + line );
      vec[k] = name;
    }
  }

  emap_params ps;
  ps.map_multioutput = opt.multioutput;
  ps.area_oriented_mapping = opt.area;
  ps.verbose = opt.verbose;
  if ( !opt.arrivals.empty() )
  {
    std::ifstream in( opt.arrivals );
    if ( !in )
      die( 3, "cannot read arrivals file " + opt.arrivals );
    std::string line;
    while ( std::getline( in, line ) )
    {
      if ( line.empty() || line[0] == '#' ) continue;
      ps.arrival_times.push_back( std::stod( line ) );
    }
    if ( ps.arrival_times.size() != npi )
      die( 3, "arrivals file has " + std::to_string( ps.arrival_times.size() ) + " values, the AIGER has " +
                  std::to_string( npi ) + " inputs" );
  }

  emap_stats st;
  cell_view<block_network> ntk = emap( aig, lib, ps, &st );
  if ( st.mapping_error )
    die( 4, "emap reported a mapping error (the genlib may lack a function emap needs, e.g. an inverter)" );

  /* write Verilog */
  auto const& cells = ntk.get_library();
  std::map<std::string, uint32_t> histogram;
  std::ostringstream body;
  std::vector<std::string> wires;
  node_map<std::vector<std::string>, cell_view<block_network>> net( ntk );
  ntk.foreach_pi( [&]( auto const& n, auto k ) { net[n] = { in_names[k] }; } );
  ntk.foreach_gate( [&]( auto const& n ) {
    std::vector<std::string> outs;
    for ( uint32_t o = 0; o < ntk.num_outputs( n ); ++o )
    {
      outs.push_back( "n" + std::to_string( ntk.node_to_index( n ) ) + "_" + std::to_string( o ) );
      wires.push_back( outs.back() );
    }
    net[n] = outs;
  } );
  uint32_t counter = 0;
  bool bad = false;
  ntk.foreach_gate( [&]( auto const& n ) {
    if ( !ntk.has_cell( n ) )
    {
      std::cerr << "emap_window: internal node " << ntk.node_to_index( n ) << " has no cell\n";
      bad = true;
      return;
    }
    auto const& cell = cells[ntk.get_cell_index( n )];
    histogram[cell.name]++;
    std::vector<std::string> args;
    uint32_t i = 0;
    ntk.foreach_fanin( n, [&]( auto const& f ) {
      if ( ntk.is_complemented( f ) )
      {
        std::cerr << "emap_window: complemented fanin on node " << ntk.node_to_index( n ) << "\n";
        bad = true;
      }
      auto const fn = ntk.get_node( f );
      std::string src;
      if ( ntk.is_constant( fn ) )
        src = ( ntk.constant_value( fn ) ^ ntk.is_complemented( f ) ) ? "1'b1" : "1'b0";
      else
        src = net[fn].at( ntk.is_pi( fn ) ? 0 : ntk.get_output_pin( f ) );
      args.push_back( "." + cell.gates[0].pins.at( i++ ).name + "(" + src + ")" );
    } );
    if ( cell.gates.size() != ntk.num_outputs( n ) )
    {
      std::cerr << "emap_window: cell " << cell.name << " output count mismatch\n";
      bad = true;
      return;
    }
    for ( uint32_t o = 0; o < cell.gates.size(); ++o )
      args.push_back( "." + cell.gates[o].output_name + "(" + net[n][o] + ")" );
    body << "  " << cell.name << " g" << counter++ << " (";
    for ( size_t a = 0; a < args.size(); ++a )
      body << ( a ? ", " : "" ) << args[a];
    body << ");\n";
  } );
  std::ostringstream assigns;
  ntk.foreach_po( [&]( auto const& f, auto k ) {
    auto const n = ntk.get_node( f );
    std::string src;
    if ( ntk.is_constant( n ) )
      src = ( ntk.constant_value( n ) ^ ntk.is_complemented( f ) ) ? "1'b1" : "1'b0";
    else
    {
      if ( ntk.is_complemented( f ) )
      {
        std::cerr << "emap_window: complemented output " << k << " (unsupported)\n";
        bad = true;
      }
      src = net[n].at( ntk.is_pi( n ) ? 0 : ntk.get_output_pin( f ) );
    }
    assigns << "  assign " << out_names[k] << " = " << src << ";\n";
  } );
  if ( bad )
    die( 4, "mapped network could not be written" );

  {
    std::ofstream os( opt.out );
    if ( !os )
      die( 3, "cannot write " + opt.out );
    os << "// emap_window (mockturtle emap 47d1e70): " << ( opt.area ? "area" : "delay" ) << "-oriented"
       << ( opt.multioutput ? ", multi-output" : "" ) << "; genlib " << opt.genlib << "\n";
    os << "module " << opt.module << " (";
    for ( uint32_t k = 0; k < npi; ++k ) os << ( k ? ", " : "" ) << in_names[k];
    for ( uint32_t k = 0; k < npo; ++k ) os << ( npi + k ? ", " : "" ) << out_names[k];
    os << ");\n";
    for ( auto const& s : in_names ) os << "  input " << s << ";\n";
    for ( auto const& s : out_names ) os << "  output " << s << ";\n";
    for ( auto const& s : wires ) os << "  wire " << s << ";\n";
    os << body.str() << assigns.str() << "endmodule\n";
  }

  double const seconds = std::chrono::duration<double>( std::chrono::steady_clock::now() - t0 ).count();
  uint32_t total = 0;
  for ( auto const& [k, v] : histogram ) total += v;
  std::ostringstream js;
  js << "{\n  \"schema\": \"hima-emap-window-stats/1\",\n  \"mockturtleCommit\": \"47d1e70fdf775e1a295016c3c17a1ad206db24c0\",\n"
     << "  \"mode\": \"" << ( opt.area ? "area" : "delay" ) << "\", \"multioutput\": " << ( opt.multioutput ? "true" : "false" )
     << ", \"allSizes\": " << ( opt.all_sizes ? "true" : "false" ) << ",\n"
     << "  \"aigInputs\": " << npi << ", \"aigOutputs\": " << npo << ", \"aigAnds\": " << aig.num_gates() << ",\n"
     << "  \"cells\": " << total << ", \"area\": " << st.area << ", \"delay\": " << st.delay
     << ", \"inverters\": " << st.inverters << ", \"multioutputGates\": " << st.multioutput_gates << ",\n"
     << "  \"arrivalTimes\": " << ( ps.arrival_times.empty() ? "false" : "true" ) << ", \"seconds\": " << seconds << ",\n"
     << "  \"histogram\": {";
  bool first = true;
  for ( auto const& [k, v] : histogram )
  {
    js << ( first ? "" : ", " ) << "\"" << json_escape( k ) << "\": " << v;
    first = false;
  }
  js << "}\n}\n";
  if ( !opt.stats.empty() )
  {
    std::ofstream os( opt.stats );
    os << js.str();
  }
  std::cout << "emap_window: " << npi << " in / " << npo << " out / " << aig.num_gates() << " AND -> " << total
            << " cells, area " << st.area << ", delay " << st.delay << ", multi-output " << st.multioutput_gates
            << ", " << seconds << " s -> " << opt.out << "\n";
  return 0;
}
