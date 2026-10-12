frbOpen {@FRB@}
frbSetCur frame
smPFlow -updateUsedFiles
frbSetup -obj BuildFrame
smPFlow -clear
smPFlow -bindBlocks
smPFlow -buildFrame frame -mchip mainchip -mblock mainchip
smPFlow -sortFix
smPFlow -sortFit
