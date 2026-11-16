; ==============================================================================
; A2SRV.S - Disk II sector server over the Super Serial Card (xa syntax)
;
; Runs inside the Apple II (a real //e or II+, or the STM32 emulator) and lets
; the PC read the floppy in slot 6 drive 1 over the SSC in slot 2. It talks to
; the Disk II directly (nibble level), so DOS does not have to be in memory -
; any 16-sector disk can be read, booted or not.
;
; Started from BASIC with BRUN A2SRV (it is on the A2REMOTE disk) or from the
; monitor with 6000G; the quit command returns there with RTS. The SSC stays
; the input device (IN#2), so the PC can go on typing commands afterwards.
;
; The 6502 does no 6&2 decoding - it sends the raw address and data field
; nibbles and the PC decodes and checks them. That keeps every disk loop
; short and leaves no timing pressure between the address and data fields.
;
; DOS 3.3 keeps the head position of slot 6 drive 1 at $047E (half tracks).
; A2SRV starts from there instead of recalibrating, and puts the head back
; there before it quits, so DOS finds the drive as it left it.
;
; Protocol (PC -> Apple - $AA sync byte, command, argument)
;   $AA 'P'          ping            -> "A2SV2" (the digit is the version)
;   $AA 'T' track    read one track  -> 'S' + 8 address nibbles + 343 data
;                                       nibbles, once per sector found (up
;                                       to 16), then 'E' + sectors missing
;                                       ('X' + missing on a timeout, e.g.
;                                       no disk; 'X' $FF on a bad track)
;   $AA 'Q'          quit            -> 'Q', head back, RTS
;   $AA 'M' addr(2) len(2) flags     memory to the PC -> 'M' + bytes + sum(2)
;   $AA 'R' page count flags         RAM test of 1-16 pages, contents kept
;                                    -> 'F' lo hi expected actual ..., 'D' errors(2)
;
; Build - xa -o a2srv.bin a2srv.s      (loads and runs at $6000)
; Memory - code $6000-$64FF, track buffer / RAM test save area $6600-$85FF,
;          zero page $06-$09 $CE $CF $EB $FA-$FF
; ==============================================================================

SLOT    = $60           ; slot 6 * 16
ACDATA  = $C0A8         ; SSC slot 2 ACIA
ACSTAT  = $C0A9
ACCMD   = $C0AA
PHOFF   = $C080         ; stepper phase 0 off (+1 on, +2 per phase)
MOTOFF  = $C088
MOTON   = $C089
DRV1    = $C08A
Q6L     = $C08C
Q7L     = $C08E
WAIT    = $FCA8
DOSTRK  = $047E         ; DOS 3.3 - slot 6 drive 1 head position, half tracks

CURHT   = $06           ; head position in half tracks
TGTHT   = $07           ; wanted half track
CNTL    = $08           ; timeout counter
CNTH    = $09
LEFT    = $FA           ; sectors still to send on this track
TRIES   = $FB           ; address fields still to look at
MOTOR   = $FC           ; 1 while the motor runs
IDLEL   = $FD
IDLEH   = $FE
ATRK    = $FF

PTRL    = $CE           ; where a sector's nibbles go
PTRH    = $CF
CURS    = $EB           ; the sector being read or sent

; A track - sector s takes the two pages from TRKBUF + 2s - on its first
; 256 data nibbles, on the second the 87 others and, at $80, the 8 address
; nibbles. Page aligned, so no indexed access crosses a page. $6600-$85FF.
TRKBUF  = $6600
TRKPG   = $66            ; its page

        * = $6000

START   php
        sei
        lda ACCMD       ; the SSC firmware's setting, put back on quit
        sta OLDCMD
        lda #$0B        ; no parity, no receive IRQ, DTR on
        sta ACCMD
        lda #0
        sta MOTOR
        sta RECAL
        lda DOSTRK      ; where DOS left the head
        sta HOMEHT
        sta CURHT
        cmp #80
        bcc HAVEPOS
        lda #1          ; no sensible position - step to 0 first
        sta RECAL
        lda #0
        sta HOMEHT
HAVEPOS jsr HELLO

; ---- wait for a command; the motor goes off after a while idle -------------
CMDLP   lda #0
        sta IDLEL
        sta IDLEH
WAITC   lda ACSTAT
        and #$08
        bne GOTB
        inc IDLEL
        bne WAITC
        inc IDLEH
        lda IDLEH
        cmp #$30
        bne WAITC
        jsr MOTORF
        jmp CMDLP
GOTB    lda ACDATA
        cmp #$AA
        bne CMDLP
        jsr GETB
        cmp #$50        ; 'P'
        beq DOPING
        cmp #$54        ; 'T'
        beq DOTRK
        cmp #$51        ; 'Q'
        beq DOQUIT
        cmp #$4D        ; 'M'
        bne NOTM
        jmp DOMEM
NOTM    cmp #$52        ; 'R'
        bne NOTR
        jmp DORAM
NOTR    jmp CMDLP

DOPING  jsr HELLO
        jmp CMDLP

; Quit - head back where DOS had it, SSC as it was, RTS to BASIC / monitor.
DOQUIT  lda CURHT
        cmp HOMEHT
        beq QHOME
        jsr MOTORN
        lda HOMEHT
        sta TGTHT
        jsr SEEK
QHOME   lda CURHT
        sta DOSTRK
        jsr MOTORF
        lda #$51
        jsr PUTB
        lda OLDCMD
        sta ACCMD
        plp
        rts
; ---- read a track -----------------------------------------------------------
; The whole track is read into memory first (one sector to two pages from
; TRKBUF on) and sent afterwards: sending while the disk turns would make
; every sector wait for the next revolution.
DOTRK   jsr GETB
        cmp #40
        bcc TRKOK
        lda #$58        ; 'X'
        jsr PUTB
        lda #$FF
        jsr PUTB
        jmp CMDLP
TRKOK   asl
        sta TGTHT
        lda #0
        sta RETRY
        jsr MOTORN
        jsr SEEK
TSTART  lda #0
        ldy #15
CLR     sta DONE,y
        dey
        bpl CLR
        lda #16
        sta LEFT
        lda #64
        sta TRIES

NEXTS   jsr RDSECT
        bcs TEND        ; nothing more within a second - send what we have
        ; 4&4 decode - ((odd << 1) | 1) & even
        lda ADDR+2
        sec
        rol
        and ADDR+3
        sta ATRK
        ; address checksum - vol ^ trk ^ sec ^ chk == 0
        lda ADDR
        sec
        rol
        and ADDR+1
        eor ATRK
        eor CURS
        sta CNTL
        lda ADDR+6
        sec
        rol
        and ADDR+7
        eor CNTL
        bne SKIP        ; bad address field
        lda TGTHT
        lsr
        cmp ATRK
        beq ONTRK
        lda ATRK        ; head was elsewhere - believe the disk, seek again
        cmp #40
        bcs SKIP
        asl
        sta CURHT
        jsr SEEK
        jmp SKIP
ONTRK   ldy #$87        ; keep the address nibbles at offset $80 of the
        ldx #7          ; sector's second page (PTR points there now)
ADCP    lda ADDR,x
        sta (PTRL),y
        dey
        dex
        bpl ADCP
        ldy CURS
        lda #1
        sta DONE,y
        dec LEFT
        beq TEND
SKIP    dec TRIES
        beq TEND
        jmp NEXTS

; Nothing at all on this track - the head may sit between tracks, or where the
; DOS position said it was not. Step it to 0 and try the track once more.
TEND    lda LEFT
        cmp #16
        bne TSENDS
        lda RETRY
        bne TSENDS
        lda #1
        sta RETRY
        sta RECAL
        jsr MOTORN
        jsr SEEK
        jmp TSTART

; send every sector read, then 'E' (all there) or 'X' (some missing) + count
TSENDS  lda #0
        sta CURS
TSEND   ldy CURS
        lda DONE,y
        beq TNEXT
        jsr SENDSEC
TNEXT   inc CURS
        lda CURS
        cmp #16
        bne TSEND
        lda LEFT
        beq TOK
        lda #$58        ; 'X'
        bne TFIN
TOK     lda #$45        ; 'E'
TFIN    jsr PUTB
        lda LEFT
        jsr PUTB
        jmp CMDLP

; ---- one address field and the data field after it, raw ---------------------
; X = slot. Carry set when no wanted sector came within about a second.
; On return CURS is the sector and PTRL/PTRH point at its second page.
RDSECT  ldx #SLOT
        lda #0
        sta CNTL
        sta CNTH
        sta PTRL
RA1     inc CNTL
        bne RA2
        inc CNTH
        bne RA2
        sec             ; about a second and nothing - give up
        rts
RA2    lda Q6L,x
        bpl RA1
        cmp #$D5
        bne RA1
RA3     lda Q6L,x
        bpl RA3
        cmp #$AA
        bne RA1
RA4     lda Q6L,x
        bpl RA4
        cmp #$96
        bne RA1
        ldy #0
RA5     lda Q6L,x
        bpl RA5
        sta ADDR,y
        iny
        cpy #8
        bne RA5
        ; A sector already read is passed over here, before its data field -
        ; deciding only after reading it would land on every other sector
        ; and miss the rest of the track for good.
        lda ADDR+4
        sec
        rol
        and ADDR+5
        tay
        cpy #16
        bcs RA1
        lda DONE,y
        bne RA1
        sty CURS
        tya
        asl
        adc #TRKPG      ; carry is clear after the asl of a value < 16
        sta PTRH
        ldy #40         ; the data prologue must follow within 40 nibbles
RD1     dey
        beq RA1
RD1A    lda Q6L,x
        bpl RD1A
        cmp #$D5
        bne RD1
RD2     lda Q6L,x
        bpl RD2
        cmp #$AA
        bne RD1
RD3     lda Q6L,x
        bpl RD3
        cmp #$AD
        bne RD1
        ldy #0
RD4     lda Q6L,x
        bpl RD4
        sta (PTRL),y
        iny
        bne RD4
        inc PTRH
RD5     lda Q6L,x
        bpl RD5
        sta (PTRL),y
        iny
        cpy #87
        bne RD5
        clc
        rts

; ---- head stepping ----------------------------------------------------------
SEEK    lda CURHT
        cmp TGTHT
        beq SKDONE
        bcc SKUP
        dec CURHT
        jmp STEP
SKUP    inc CURHT
STEP    lda CURHT
        and #3
        asl
        ora #SLOT
        tax
        lda PHOFF+1,x   ; that phase on (about 8 ms a half track)
        lda #$38
        jsr WAIT
        lda PHOFF,x     ; and off again
        jmp SEEK
SKDONE  lda #$30
        jsr WAIT
        ldx #SLOT
        rts

MOTORN  ldx #SLOT
        lda DRV1,x
        lda MOTON,x
        lda Q7L,x       ; read mode
        lda Q6L,x
        lda MOTOR
        bne MRUN
        lda #1
        sta MOTOR
        lda #$FF        ; let it spin up
        jsr WAIT
        lda #$FF
        jsr WAIT
MRUN    lda RECAL
        beq MDONE
        lda #0          ; first time - the head can be anywhere; step it to 0
        sta RECAL
        lda TGTHT
        pha
        lda #80
        sta CURHT
        lda #0
        sta TGTHT
        jsr SEEK
        pla
        sta TGTHT
MDONE   ldx #SLOT
        rts

MOTORF  ldx #SLOT
        lda MOTOFF,x
        lda #0
        sta MOTOR
        rts

; ---- memory map for M and R -------------------------------------------------
; MFLAGS bit 0  ROM at $D000-$FFFF       ($C082)
;        bit 1  LC RAM bank 1, read+write ($C08B twice)
;        bit 2  LC RAM bank 2, read+write ($C083 twice)
;        bit 3  //e internal $C100-$CFFF ROM (INTCXROM, put back after)
;        bit 7  R only - the block is scratch, no save/restore
; After bits 0-2 the map is left as ROM read, write protected ($C082), the
; state DOS 3.3 with Applesoft in ROM runs in.
MAPIN   lda MFLAGS
        lsr
        bcc MI1
        bit $C082
MI1     lsr
        bcc MI2
        bit $C08B
        bit $C08B
MI2     lsr
        bcc MI3
        bit $C083
        bit $C083
MI3     lsr
        bcc MI4
        lda $C015       ; //e - bit 7 set while INTCXROM is on
        sta OLDCX
        sta $C007
MI4     rts

MAPOUT  lda MFLAGS
        and #$07
        beq MO1
        bit $C082
MO1     lda MFLAGS
        and #$08
        beq MO2
        lda OLDCX
        bmi MO2
        sta $C006
MO2     rts

; ---- M - memory to the PC -----------------------------------------------------
; $AA 'M' addrlo addrhi lenlo lenhi flags -> 'M', len bytes, sum lo, sum hi
; (16-bit sum of the bytes). $C000-$C0FF is never read - reading a soft switch
; can start the disk motor or take a byte from the SSC - and goes as $00.
DOMEM   jsr GETB
        sta PTRL
        jsr GETB
        sta PTRH
        jsr GETB
        sta CNTL
        jsr GETB
        sta CNTH
        jsr GETB
        sta MFLAGS
        jsr MAPIN
        lda #$4D        ; 'M'
        jsr PUTB
        lda #0
        sta SUML
        sta SUMH
        ldy #0
MLOOP   lda PTRH
        cmp #$C0
        bne MRD
        lda #0
        beq MPUT
MRD     lda (PTRL),y
MPUT    pha
        clc
        adc SUML
        sta SUML
        bcc MS1
        inc SUMH
MS1     pla
        jsr PUTB
        inc PTRL
        bne MS2
        inc PTRH
MS2     lda CNTL
        bne MS3
        dec CNTH
MS3     dec CNTL
        lda CNTL
        ora CNTH
        bne MLOOP
        jsr MAPOUT
        lda SUML
        jsr PUTB
        lda SUMH
        jsr PUTB
        jmp CMDLP

; ---- R - RAM test of one block ------------------------------------------------
; $AA 'R' page count(1-16) flags -> 'F' lo hi expected actual (first 32
; errors), then 'D' errors lo, errors hi.
; The block is copied to SAVEBUF, then filled and checked four times with
; lo ^ page ^ K (K = $00 $FF $55 $AA) - every bit is 0 and 1 at each address,
; and any two addresses in the block differ, so stuck bits and address faults
; inside the block show - and then copied back. Interrupts are off and no
; ROM is called meanwhile, so DOS, the screen and a BASIC program survive.
SAVEPG  = $66           ; SAVEBUF $6600-$75FF (the track buffer)
CURP    = $FA           ; page being worked on
PATK    = $FB           ; pattern constant
SAVP    = $FF           ; page in SAVEBUF
DSTL    = $FD
DSTH    = $FE

DORAM   jsr GETB
        sta RPAGE
        jsr GETB
        sta RCNT
        jsr GETB
        sta MFLAGS
        jsr MAPIN
        lda #0
        sta ERRL
        sta ERRH
        bit MFLAGS
        bmi RNOSAV
        lda #0
        jsr BCOPY       ; block -> SAVEBUF
RNOSAV  ldx #3
RPAT    lda PATS,x
        sta PATK
        stx CURS
        jsr RFILL
        jsr RVERIFY
        ldx CURS
        dex
        bpl RPAT
        bit MFLAGS
        bmi RNOREST
        lda #1
        jsr BCOPY       ; SAVEBUF -> block
RNOREST jsr MAPOUT
        lda #$44        ; 'D'
        jsr PUTB
        lda ERRL
        jsr PUTB
        lda ERRH
        jsr PUTB
        jmp CMDLP

; A = 0 - block to SAVEBUF, 1 - SAVEBUF to block
BCOPY   sta CNTL
        lda #0
        sta PTRL
        sta DSTL
        lda RCNT
        sta CNTH
        lda RPAGE
        sta CURP
        lda #SAVEPG
        sta SAVP
BCP1    lda CNTL
        bne BCP2
        lda CURP
        sta PTRH
        lda SAVP
        sta DSTH
        jmp BCP3
BCP2    lda SAVP
        sta PTRH
        lda CURP
        sta DSTH
BCP3    ldy #0
BCP4    lda (PTRL),y
        sta (DSTL),y
        iny
        bne BCP4
        inc CURP
        inc SAVP
        dec CNTH
        bne BCP1
        rts

RFILL   lda #0
        sta PTRL
        lda RPAGE
        sta CURP
        lda RCNT
        sta CNTH
RF1     lda CURP
        sta PTRH
        ldy #0
RF2     tya
        eor CURP
        eor PATK
        sta (PTRL),y
        iny
        bne RF2
        inc CURP
        dec CNTH
        bne RF1
        rts

RVERIFY lda #0
        sta PTRL
        lda RPAGE
        sta CURP
        lda RCNT
        sta CNTH
RV1     lda CURP
        sta PTRH
        ldy #0
RV2     tya
        eor CURP
        eor PATK
        cmp (PTRL),y
        bne RBAD
RV3     iny
        bne RV2
        inc CURP
        dec CNTH
        bne RV1
        rts
RBAD    sta CNTL        ; expected
        inc ERRL
        bne RB1
        inc ERRH
RB1     lda ERRH
        bne RV3
        lda ERRL
        cmp #33
        bcs RV3
        lda #$46        ; 'F'
        jsr PUTB
        tya
        jsr PUTB
        lda CURP
        jsr PUTB
        lda CNTL
        jsr PUTB
        lda (PTRL),y
        jsr PUTB
        jmp RV3

PATS    .byt $00,$FF,$55,$AA

; ---- SSC --------------------------------------------------------------------
GETB    lda ACSTAT
        and #$08
        beq GETB
        lda ACDATA
        rts

PUTB    pha
PUTW    lda ACSTAT
        and #$10
        beq PUTW
        pla
        sta ACDATA
        rts

HELLO   ldy #0
HL1     lda HELLOS,y
        beq HL2
        jsr PUTB
        iny
        bne HL1
HL2     rts

; Sector CURS from the track buffer - 'S', 8 address nibbles, 343 data
; nibbles. The send loops are inline (no JSR PUTB).
SENDSEC lda #$53        ; 'S'
        jsr PUTB
        lda #0
        sta PTRL
        lda CURS
        asl
        clc
        adc #TRKPG+1     ; the second page first, for the address
        sta PTRH
        ldy #$80
SS1     lda ACSTAT
        and #$10
        beq SS1
        lda (PTRL),y
        sta ACDATA
        iny
        cpy #$88
        bne SS1
        dec PTRH
        ldy #0
SS2     lda ACSTAT
        and #$10
        beq SS2
        lda (PTRL),y
        sta ACDATA
        iny
        bne SS2
        inc PTRH
SS3     lda ACSTAT
        and #$10
        beq SS3
        lda (PTRL),y
        sta ACDATA
        iny
        cpy #87
        bne SS3
        rts

HELLOS  .asc "A2SV2"     ; 2 - with M and R
        .byt 0
RECAL   .byt 0
RETRY   .byt 0
HOMEHT  .byt 0
OLDCMD  .byt 0
MFLAGS  .byt 0
OLDCX   .byt 0
SUML    .byt 0
SUMH    .byt 0
RPAGE   .byt 0
RCNT    .byt 0
ERRL    .byt 0
ERRH    .byt 0
ADDR    .dsb 8,0
DONE    .dsb 16,0
