* synth180 devices (synthetic)
.model nch nmos level=54 version=4.8 toxe=4e-9 toxp=4e-9 toxm=4e-9 vth0='0.45+dvn' k1=0.55 k2=0.02 u0='0.035*kmu' vsat=8e4 ndep=1.7e17 rdsw=200 pclm=0.9 pdiblc2=0.008 voff=-0.1 nfactor=1.2
.model pch pmos level=54 version=4.8 toxe=4e-9 toxp=4e-9 toxm=4e-9 vth0='-0.45+dvp' k1=0.55 k2=0.02 u0='0.010*kmu' vsat=7e4 ndep=1.7e17 rdsw=400 pclm=0.9 pdiblc2=0.008 voff=-0.1 nfactor=1.2
