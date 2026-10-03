// Synthetic six-block netlist for the ATCS dry path (Issue #63, six slots for Issue #64). Each block
// holds two leaf cells: reg0, whose input pin I is the block's setup endpoint and its slot's edit
// domain, and reg1. Masters follow the Site sizing pattern D<n>BWP. One top-level boundary buffer
// x_<left><right> joins each pair of neighbouring blocks (Issue #66 T4): a slot's session derives its
// block's two cells plus the boundary buffers one hop out, so neighbours' derived domains share
// exactly the buffer between them and never a block cell.
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
  wire a_z, n_ab, b_z, n_bc, c_z, n_cd, d_z, n_de, e_z, n_ef;
  blk_a u_a (.a(in_a), .z(a_z));
  BUFFD1BWP x_ab (.I(a_z), .Z(n_ab));
  blk_b u_b (.a(n_ab), .z(b_z));
  BUFFD1BWP x_bc (.I(b_z), .Z(n_bc));
  blk_c u_c (.a(n_bc), .z(c_z));
  BUFFD1BWP x_cd (.I(c_z), .Z(n_cd));
  blk_d u_d (.a(n_cd), .z(d_z));
  BUFFD1BWP x_de (.I(d_z), .Z(n_de));
  blk_e u_e (.a(n_de), .z(e_z));
  BUFFD1BWP x_ef (.I(e_z), .Z(n_ef));
  blk_f u_f (.a(n_ef), .z(out_z));
endmodule
