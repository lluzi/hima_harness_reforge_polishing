// Synthetic three-block netlist for the ATCS dry path (Issue #63). Each block holds two leaf cells,
// reg0 (a slot's edit domain) and reg1 (that slot's protected cell), as the Pack's knowledge
// example-campaign-plan.md names them. Masters follow the Site sizing pattern D<n>BWP.
module blk_a (a, z);
  input a;
  output z;
  wire n1;
  BUFFD1BWP reg0 (.I(a), .Z(n1));
  BUFFD1BWP reg1 (.I(n1), .Z(z));
endmodule

module blk_b (a, z);
  input a;
  output z;
  wire n1;
  BUFFD1BWP reg0 (.I(a), .Z(n1));
  BUFFD1BWP reg1 (.I(n1), .Z(z));
endmodule

module blk_c (a, z);
  input a;
  output z;
  wire n1;
  BUFFD1BWP reg0 (.I(a), .Z(n1));
  BUFFD1BWP reg1 (.I(n1), .Z(z));
endmodule

module top (in_a, out_z);
  input in_a;
  output out_z;
  wire n_ab, n_bc;
  blk_a u_a (.a(in_a), .z(n_ab));
  blk_b u_b (.a(n_ab), .z(n_bc));
  blk_c u_c (.a(n_bc), .z(out_z));
endmodule
