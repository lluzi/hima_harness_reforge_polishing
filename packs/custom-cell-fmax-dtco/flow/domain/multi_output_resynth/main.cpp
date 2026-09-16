// Pinned mockturtle diagnostic mapper for the isolated multi-output POC.
//
// This binary deliberately does not emit an ECO netlist.  The Python deep
// module owns source provenance, local patching, rollback, and equivalence.
// These fixtures establish what pinned mockturtle emap actually maps before a
// future AIG/source-map adapter is allowed to rely on it.

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <lorina/genlib.hpp>
#include <mockturtle/algorithms/emap.hpp>
#include <mockturtle/generators/arithmetic.hpp>
#include <mockturtle/io/genlib_reader.hpp>
#include <mockturtle/networks/aig.hpp>
#include <mockturtle/networks/block.hpp>
#include <mockturtle/utils/tech_library.hpp>
#include <mockturtle/views/cell_view.hpp>

using namespace mockturtle;

namespace {

constexpr char const* library_text =
    "GATE inv1 1 O=!a; PIN * INV 1 999 0.9 0.3 0.9 0.3\n"
    "GATE nand2 2 O=!(a*b); PIN * INV 1 999 1.0 0.2 1.0 0.2\n"
    "GATE and2 3 O=a*b; PIN * NONINV 1 999 1.7 0.2 1.7 0.2\n"
    "GATE or2 3 O=a+b; PIN * NONINV 1 999 1.7 0.2 1.7 0.2\n"
    "GATE xor2 4 O=a^b; PIN * UNKNOWN 2 999 1.9 0.5 1.9 0.5\n"
    "GATE mig3 3 O=a*b+a*c+b*c; PIN * INV 1 999 2.0 0.2 2.0 0.2\n"
    "GATE xor3 5 O=a^b^c; PIN * UNKNOWN 2 999 3.0 0.5 3.0 0.5\n"
    "GATE buf 2 O=a; PIN * NONINV 1 999 1.0 0.0 1.0 0.0\n"
    "GATE zero 0 O=CONST0;\n"
    "GATE one 0 O=CONST1;\n"
    "GATE ha 5 C=a*b; PIN * INV 1 999 1.7 0.4 1.7 0.4\n"
    "GATE ha 5 S=!a*b+a*!b; PIN * INV 1 999 2.1 0.4 2.1 0.4\n"
    "GATE fa 6 C=a*b+a*c+b*c; PIN * INV 1 999 2.1 0.4 2.1 0.4\n"
    "GATE fa 6 S=a^b^c; PIN * INV 1 999 3.0 0.4 3.0 0.4\n"
    "GATE pair 4 P=a*b; PIN * NONINV 1 999 1.7 0.4 1.7 0.4\n"
    "GATE pair 4 Q=a+b; PIN * NONINV 1 999 1.7 0.4 1.7 0.4\n";

struct result
{
  uint32_t pis{};
  uint32_t pos{};
  uint32_t gates{};
  uint32_t multioutput{};
  double area{};
  double delay{};
};

template<typename Builder>
result run( Builder&& build )
{
  std::vector<gate> gates;
  std::istringstream input( library_text );
  if ( lorina::read_genlib( input, genlib_reader( gates ) ) != lorina::return_code::success )
  {
    throw std::runtime_error( "GENLIB parse failed" );
  }
  tech_library_params library_params;
  library_params.load_multioutput_gates_single = false;
  tech_library<3, classification_type::p_configurations> library( gates, library_params );
  aig_network network;
  build( network );
  emap_params params;
  params.map_multioutput = true;
  params.area_oriented_mapping = true;
  emap_stats stats;
  cell_view<block_network> mapped = emap( network, library, params, &stats );
  return {mapped.num_pis(), mapped.num_pos(), mapped.num_gates(),
          stats.multioutput_gates, stats.area, stats.delay};
}

result ripple8()
{
  return run( []( aig_network& network ) {
    std::vector<aig_network::signal> a( 8 ), b( 8 );
    std::generate( a.begin(), a.end(), [&]() { return network.create_pi(); } );
    std::generate( b.begin(), b.end(), [&]() { return network.create_pi(); } );
    auto carry = network.get_constant( false );
    carry_ripple_adder_inplace( network, a, b, carry );
    for ( auto signal : a )
      network.create_po( signal );
    network.create_po( carry );
  } );
}

result non_fa_pair()
{
  return run( []( aig_network& network ) {
    auto a = network.create_pi();
    auto b = network.create_pi();
    network.create_po( network.create_and( a, b ) );
    network.create_po( network.create_or( a, b ) );
  } );
}

} // namespace

int main( int argc, char** argv )
{
  if ( argc != 3 || std::string( argv[1] ) != "--fixture" )
  {
    std::cerr << "usage: hima-mo-mockturtle-poc --fixture ripple8|nonfa\n";
    return 2;
  }
  try
  {
    auto const fixture = std::string( argv[2] );
    auto const mapped = fixture == "ripple8" ? ripple8()
                        : fixture == "nonfa" ? non_fa_pair()
                                               : throw std::runtime_error( "unknown fixture" );
    std::cout << "{\"schema\":\"hima.mockturtle-multi-output-poc/1\","
              << "\"fixture\":\"" << fixture << "\","
              << "\"pis\":" << mapped.pis << ",\"pos\":" << mapped.pos << ','
              << "\"gates\":" << mapped.gates << ','
              << "\"multioutputGates\":" << mapped.multioutput << ','
              << "\"area\":" << mapped.area << ",\"delay\":" << mapped.delay << "}\n";
    return 0;
  }
  catch ( std::exception const& error )
  {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
