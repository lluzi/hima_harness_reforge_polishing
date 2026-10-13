foreach {mage_verify_type mage_verify_cmd} {OVERLAP frbCheckOverlap SPACE frbCheckSpace BOUNDARY frbCheckBoundary} {
    puts [list MAGE_VERIFY_BEGIN $mage_verify_type]
    flush stdout
    set mage_verify_code [catch {$mage_verify_cmd} mage_verify_msg]
    set mage_verify_code2 [catch {$mage_verify_cmd -print} mage_verify_msg2]
    flush stdout
    puts [list MAGE_VERIFY_CODE $mage_verify_type [expr {$mage_verify_code || $mage_verify_code2}]]
    puts [list MAGE_VERIFY_END $mage_verify_type]
    flush stdout
}
smPInstMgr -saveMark {@OUT@/export.pla}
smPFlow -saveSummary {@OUT@/summary.txt}
puts [list MAGE_ROUND_END code 0]
