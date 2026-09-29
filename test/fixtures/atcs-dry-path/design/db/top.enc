// Synthetic two-level netlist for the ATCS dry path (Issue #63): one leaf cell, u_a/reg0.
module blk_a (a, z);
  input a;
  output z;
  BUF1 reg0 (.D(a), .Q(z));
endmodule

module top (in_a, out_z);
  input in_a;
  output out_z;
  blk_a u_a (.a(in_a), .z(out_z));
endmodule
