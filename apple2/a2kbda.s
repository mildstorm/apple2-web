; ==============================================================================
; A2KBDA.S - keyboard input from the cassette port, the SSC and the keys (xa)
;
; For an Apple II whose keyboard does not work. BRUN A2KBDA (the A2REMOTE
; disk's HELLO does it) makes this the input routine (KSW, through DOS) -
; while BASIC or DOS waits for a key, it takes one from
;   - the keyboard ($C000), if any key works,
;   - the Super Serial Card in slot 2, if one is there (its ROM ID bytes),
;   - the cassette input ($C060) - the PC plays a packet as sound.
; A packet holds one or more lines; they wait in a buffer and are handed out
; a key at a time, so a line that comes while DOS is still busy with the one
; before is not lost.
;
; Cassette packet (the PC's audio_keys.js writes it; times are half cycles,
; one level between two edges) -
;   leader   833 us halves (600 Hz), at least 64 of them
;   sync     one 150 us half, one 250 us half
;   bytes    MSB first; bit 0 = two 250 us halves, bit 1 = two 500 us halves
;            LEN (1-255), LEN data bytes, CHK = $A5 ^ LEN ^ data...
; A bad packet beeps and is dropped.
;
; Half cycles are measured by counting a 14-cycle polling loop (13.7 us).
;
; Build - xa -o a2kbda.bin a2kbda.s     (loads and runs at $9300)
; Memory - $9300-$95FF (code, then the 256-byte buffer at $9500), so HIMEM
;          must be $9300 (37632) or lower; zero page $EB.
; ==============================================================================

KBD     = $C000
KBDSTRB = $C010
TAPEIN  = $C060
ACDATA  = $C0A8         ; SSC slot 2 ACIA
ACSTAT  = $C0A9
KSWL    = $38
KSWH    = $39
CH      = $24
BASL    = $28
DOSHOOK = $03EA         ; DOS 3.3 - take the I/O hooks again
BELL1   = $FBDD         ; monitor - beep

LASTIN  = $EB           ; last cassette input level (bit 7)

BUF     = $9500

LDMIN   = 45            ; a leader half is 45-99 loop counts (833 us = 61)
LDMAX   = 100
LDNEED  = 64            ; leader halves before a sync counts
SYNMAX  = 25            ; a sync half is shorter (150 us = 11)
BITTHR  = 52            ; full cycle - 0 = about 36, 1 = about 72

        * = $9300

; ---- BRUN entry - become the input routine ----------------------------------
INSTALL lda #<KIN
        sta KSWL
        lda #>KIN
        sta KSWH
        lda #0
        sta SSCON
        sta BUFLEN
        sta BUFPOS
        lda $C205       ; SSC / Pascal 1.1 firmware ID - $38 at $Cn05,
        cmp #$38        ; $18 at $Cn07
        bne NOSSC
        lda $C207
        cmp #$18
        bne NOSSC
        inc SSCON
NOSSC   lda TAPEIN
        sta LASTIN
        jmp DOSHOOK     ; DOS copies KSW into its table; its RTS returns

; ---- KSW - called by RDKEY - A = the character under the cursor, Y = CH ------
KIN     sta SAVCH
        stx SAVX
        sty SAVY
NEXT    ldx BUFPOS
        cpx BUFLEN
        bcs POLL
        lda BUF,x
        inc BUFPOS
        ora #$80
        bne DONE
POLL    lda KBD
        bpl P1
        bit KBDSTRB
        jmp DONE
P1      lda SSCON
        beq P2
        lda ACSTAT
        and #$08
        beq P2
        lda ACDATA
        ora #$80
        bne DONE
P2      lda TAPEIN
        eor LASTIN
        bpl POLL
        eor LASTIN      ; an edge - maybe a packet
        sta LASTIN
        jsr RXPKT
        bcc NEXT
        jmp POLL
DONE    pha
        lda SAVCH
        ldy SAVY
        sta (BASL),y    ; take the cursor away
        pla
        ldx SAVX
        rts

; ---- one cassette packet into BUF; carry clear when one came -----------------
RXPKT   lda #0
        sta CNT
RX1     jsr HALF
        bcs RXNONE
        cpx #LDMIN
        bcc RXSHORT
        cpx #LDMAX
        bcs RXNONE
        lda CNT
        cmp #$FF
        beq RX1
        inc CNT
        bne RX1
RXSHORT lda CNT         ; not after a leader - noise
        cmp #LDNEED
        bcc RXNONE
        cpx #SYNMAX
        bcs RXNONE
        jsr HALF        ; second sync half
        bcs RXBAD
        jsr RDBYTE      ; LEN
        bcs RXBAD
        sta LEN
        cmp #0
        beq RXBAD
        eor #$A5
        sta CHK
        ldy #0
RX2     jsr RDBYTE
        bcs RXBAD
        sta BUF,y
        eor CHK
        sta CHK
        iny
        cpy LEN
        bne RX2
        jsr RDBYTE      ; check byte
        bcs RXBAD
        cmp CHK
        bne RXBAD
        lda LEN
        sta BUFLEN
        lda #0
        sta BUFPOS
        clc
        rts
RXBAD   jsr BELL1
RXNONE  sec
        rts

; a byte, MSB first; carry set on a timeout
RDBYTE  lda #1          ; sentinel - out into carry after 8 bits
        sta SHIFT
RB1     jsr HALF
        bcs RBERR
        stx TMP
        jsr HALF
        bcs RBERR
        txa
        clc
        adc TMP         ; the full cycle; past 255 is a 1 anyway
        bcs RB2
        cmp #BITTHR     ; carry = 1 bit
RB2     rol SHIFT
        bcc RB1
        lda SHIFT
        clc
        rts
RBERR   sec
        rts

; one half cycle - X = 14-cycle loop counts until the next edge; carry set
; when none came within 255 counts (3.5 ms)
; An edge is believed only if the new level is still there 6 counts (about
; 80 us) later - noise around a slow or ringing edge makes the comparator
; flip back and forth, and a flip that goes back is not an edge.
HALF    ldx #0
HF1     inx
        beq HTOUT
        lda TAPEIN
        eor LASTIN
        bpl HF1
        lda #6
        sta DBNC
HF2     inx
        beq HTOUT
        dec DBNC
        bne HF2
        lda TAPEIN
        eor LASTIN
        bpl HF1         ; back again - noise, keep counting
        eor LASTIN
        sta LASTIN
        clc
        rts
HTOUT   sec
        rts

SSCON   .byt 0
BUFLEN  .byt 0
BUFPOS  .byt 0
SAVCH   .byt 0
SAVX    .byt 0
SAVY    .byt 0
CNT     .byt 0
LEN     .byt 0
CHK     .byt 0
SHIFT   .byt 0
TMP     .byt 0
DBNC    .byt 0
