frbOpen {@FRB@}
frbSetCur frame
frbSetup -obj BuildFrame
smPFlow -setAutoRefine -arEnabled 0
smPFlow -bindBlocks
smPFlow -buildFrame frame -mchip mainchip -mblock mainchip
