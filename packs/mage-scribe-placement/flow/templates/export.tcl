smPInstMgr -saveMark {@OUT@/export.pla}
catch {smPInstMgr -savePlaDBU {@OUT@/export-dbu.pla}} mage_export_dbu_msg
smPFlow -saveSummary {@OUT@/summary.txt}
puts [list MAGE_ROUND_END code 0]
exit 0
