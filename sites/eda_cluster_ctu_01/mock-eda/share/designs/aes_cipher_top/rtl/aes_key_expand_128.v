// aes_key_expand_128: on-the-fly key expansion (MOCK EDA demo design outline; not synthesized).
module aes_key_expand_128 (clk, kld, key, wo_0, wo_1, wo_2, wo_3);
  input clk, kld;
  input [127:0] key;
  output [31:0] wo_0, wo_1, wo_2, wo_3;
  reg [31:0] w [3:0];
  // u0..u3: aes_sbox on the rotated last word; r0: aes_rcon round constant.
endmodule
