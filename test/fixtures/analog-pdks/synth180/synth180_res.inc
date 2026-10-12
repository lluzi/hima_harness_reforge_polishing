* synth180 high-resistance poly resistor (synthetic, made up): 3 terminals, s segments in series
.subckt sres 1 2 3 r_length=1e-5 r_width=1e-6 s=1
.param r_sqrtarea='sqrt(s*r_length*r_width)'
.param var_r='1e-8/r_sqrtarea'
.param mis_r='agauss(0,var_r,1)'
rb 1 2 r='s*(r_length/r_width*rsh_sres+200)*(1-1e-3*(temper-27)+2e-6*(temper-27)*(temper-27))*(1+mis_r*sw_stat_mismatch)'
cs 1 3 '0.05e-3*s*r_length*r_width'
.ends sres
