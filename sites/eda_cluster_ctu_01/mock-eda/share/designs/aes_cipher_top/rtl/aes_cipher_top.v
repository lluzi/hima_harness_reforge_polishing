// aes_cipher_top: AES-128 encryption core, one round per clock (MOCK EDA demo design of the Site
// eda_cluster_ctu_01). Structural outline only: the mock flow reads this file list, it does not
// synthesize it. Submodules: aes_key_expand_128 (u0) and 16 data-path S-boxes (us00..us33).
module aes_cipher_top (clk, rst, ld, done, key, text_in, text_out);
  input          clk, rst, ld;
  output         done;
  input  [127:0] key;
  input  [127:0] text_in;
  output [127:0] text_out;

  reg    [127:0] text_in_r;
  reg    [7:0]   sa00, sa01, sa02, sa03, sa10, sa11, sa12, sa13;
  reg    [7:0]   sa20, sa21, sa22, sa23, sa30, sa31, sa32, sa33;
  reg    [3:0]   dcnt;
  reg            ld_r, done;
  wire   [31:0]  w0, w1, w2, w3;

  aes_key_expand_128 u0 (.clk(clk), .kld(ld), .key(key), .wo_0(w0), .wo_1(w1), .wo_2(w2), .wo_3(w3));
  // us00 .. us33: aes_sbox instances on the state bytes; MixColumns XOR trees after ShiftRows.
endmodule
