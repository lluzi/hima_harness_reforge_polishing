* synth180 vertical PNP, 10 um x 10 um emitter (synthetic Gummel-Poon, made up)
.subckt spnp c b e
.param mis_is='agauss(0,0.01,1)'
q0 c b e spnp_m
.model spnp_m pnp is='2e-17*ispnp*(1+mis_is*sw_stat_mismatch)' bf='4*bfpnp' br=0.02 nf=1 nr=1 vaf=120 var=20
+ ikf=3e-3 ise=1e-16 ne=1.6 rb=30 re=1 rc=10 cje=1e-13 cjc=5e-14 vje=0.7 vjc=0.6 mje=0.33 mjc=0.33
+ tf=1e-10 eg=1.12 xti=3 xtb=0 tnom=27
.ends spnp
* synth180 capacitor (synthetic, 2 fF/um2)
.subckt scap 1 2 c_length=1e-5 c_width=1e-5
c0 1 2 '2e-3*c_length*c_width'
.ends scap
