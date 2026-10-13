# hima:prelude-begin  (Pack-owned; the only way a stage opens the case or writes a boundary)
set hima_case_frb {@FRB@}
set hima_case_dir {@CASE_DIR@}
set hima_start_pla {@START_PLA@}
set hima_out {@OUT@}
set hima_stage_boundary "prelude"
set hima_snap_index 0
proc hima_open_build {args} {
    global hima_case_frb hima_stage_boundary
    frbOpen $hima_case_frb
    frbSetCur frame
    smPFlow -updateUsedFiles
    frbSetup -obj BuildFrame
    smPFlow -clear
    smPFlow -bindBlocks
    eval [concat [list smPFlow -buildFrame frame -mchip mainchip -mblock mainchip] $args]
    smPFlow -sortFix
    smPFlow -sortFit
    set hima_stage_boundary "open-build"
}
proc hima_snapshot {name} {
    global hima_out hima_snap_index hima_stage_boundary
    if {![regexp {^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$} $name]} { error "hima_snapshot: invalid boundary name $name" }
    incr hima_snap_index
    set dir [file join $hima_out [format "snap-%02d-%s" $hima_snap_index $name]]
    file mkdir $dir
    smPInstMgr -saveMark [file join $dir placement.pla]
    smPFlow -saveSummary [file join $dir summary.txt]
    puts [list MAGE_SNAPSHOT $hima_snap_index $name]
    flush stdout
    set hima_stage_boundary $name
}
proc hima_check {} {
    global hima_snap_index
    foreach {hima_t hima_c} {OVERLAP frbCheckOverlap SPACE frbCheckSpace BOUNDARY frbCheckBoundary} {
        puts [list MAGE_CHECK_BEGIN $hima_snap_index $hima_t]
        flush stdout
        set hima_code1 [catch {$hima_c} hima_m1]
        set hima_code2 [catch {$hima_c -print} hima_m2]
        flush stdout
        puts [list MAGE_CHECK_CODE $hima_snap_index $hima_t [expr {$hima_code1 || $hima_code2}]]
        puts [list MAGE_CHECK_END $hima_snap_index $hima_t]
        flush stdout
    }
}
# hima:prelude-end
