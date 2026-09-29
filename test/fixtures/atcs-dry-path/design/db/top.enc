// Synthetic six-block netlist for the ATCS dry path (Issue #63, six slots for Issue #64). Each block
// holds two leaf cells: reg0, whose input pin I is the block's setup endpoint and its slot's edit
// domain, and reg1. Masters follow the Site sizing pattern D<n>BWP.
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

module blk_d (a, z);
  input a;
  output z;
  wire n1;
  BUFFD1BWP reg0 (.I(a), .Z(n1));
  BUFFD1BWP reg1 (.I(n1), .Z(z));
endmodule

module blk_e (a, z);
  input a;
  output z;
  wire n1;
  BUFFD1BWP reg0 (.I(a), .Z(n1));
  BUFFD1BWP reg1 (.I(n1), .Z(z));
endmodule

module blk_f (a, z);
  input a;
  output z;
  wire n1;
  BUFFD1BWP reg0 (.I(a), .Z(n1));
  BUFFD1BWP reg1 (.I(n1), .Z(z));
endmodule

module top (in_a, out_z);
  input in_a;
  output out_z;
  wire n_ab, n_bc, n_cd, n_de, n_ef;
  blk_a u_a (.a(in_a), .z(n_ab));
  blk_b u_b (.a(n_ab), .z(n_bc));
  blk_c u_c (.a(n_bc), .z(n_cd));
  blk_d u_d (.a(n_cd), .z(n_de));
  blk_e u_e (.a(n_de), .z(n_ef));
  blk_f u_f (.a(n_ef), .z(out_z));
endmodule
