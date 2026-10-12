* synth180 3.3 V devices (synthetic BSIM4, made up; thicker oxide, higher threshold, stronger body effect)
.model nch33 nmos level=54 version=4.8 toxe=7e-9 toxp=7e-9 toxm=7e-9 vth0='0.62+dvn' k1=0.75 k2=0.02 u0='0.040*kmu' vsat=8e4 ndep=1.7e17 rdsw=300 pclm=0.9 pdiblc2=0.004 voff=-0.1 nfactor=1.3
.model pch33 pmos level=54 version=4.8 toxe=7e-9 toxp=7e-9 toxm=7e-9 vth0='-0.70+dvp' k1=0.75 k2=0.02 u0='0.012*kmu' vsat=7e4 ndep=1.7e17 rdsw=500 pclm=0.9 pdiblc2=0.004 voff=-0.1 nfactor=1.3
