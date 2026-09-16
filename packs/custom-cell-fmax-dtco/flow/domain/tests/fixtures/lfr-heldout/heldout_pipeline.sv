module heldout_pipeline(
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
  // Structurally distinct from AES. This three-input function matches one
  // retained custom function but is expressed as ordinary RTL.
  assign combined = ~((~(launch_q & a)) ^ b);
  always @(posedge clk)
    observed_q <= combined;
  assign observed = observed_q;
endmodule
