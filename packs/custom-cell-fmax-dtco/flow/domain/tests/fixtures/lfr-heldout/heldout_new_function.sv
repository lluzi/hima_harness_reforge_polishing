module heldout_new_function(
  input  wire clk,
  input  wire seed,
  input  wire a,
  input  wire b,
  input  wire c,
  output wire observed
);
  reg launch_q;
  reg observed_q;
  wire combined;
  always @(posedge clk)
    launch_q <= seed;
  assign combined = ~(((~(a ^ b)) | c) & launch_q);
  always @(posedge clk)
    observed_q <= combined;
  assign observed = observed_q;
endmodule
