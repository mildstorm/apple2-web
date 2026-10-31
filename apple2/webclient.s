; ==============================================================================
; WEBCLIENT.S - Apple II Super Serial Card 6502 Machine Language Terminal Client
; Target: Apple II / II+ / //e with Super Serial Card in Slot 2
; ==============================================================================

; ACIA 6551 Registers for Slot 2 (Base $C0A0)
ACIA_DATA    = $C0A8    ; Transmit / Receive Data Register
ACIA_STATUS  = $C0A9    ; Status Register (Bit 4: TX Empty, Bit 3: RX Full)
ACIA_CMD     = $C0AA    ; Command Register
ACIA_CTRL    = $C0AB    ; Control Register (Baud rate, Word format)

; Apple II Hardware & ROM Routines
KBD          = $C000    ; Keyboard data & strobe ($80 = pressed)
KBDSTRB      = $C010    ; Keyboard strobe clear
COUT         = $FDED    ; ROM: Output character in Accumulator to screen
CROUT        = $FD8E    ; ROM: Carriage return output
HOME         = $FC58    ; ROM: Clear text screen
PRBYTE       = $FDDA    ; ROM: Print byte in hex

            .ORG $2000

START:
            JSR HOME            ; Clear screen

            ; Print welcome banner
            LDX #0
PRINT_BANNER:
            LDA BANNER_MSG,X
            BEQ INIT_ACIA
            JSR COUT
            INX
            BNE PRINT_BANNER

INIT_ACIA:
            ; Set 9600 Baud, 8 Data Bits, 1 Stop Bit ($1E = %00011110)
            LDA #$1E
            STA ACIA_CTRL

            ; Set No Parity, RTS Low, DTR Low, No IRQ ($0B = %00001011)
            LDA #$0B
            STA ACIA_CMD

            ; Flush any existing bytes in RX buffer
FLUSH_RX:
            LDA ACIA_STATUS
            AND #$08            ; Bit 3 = RX Full
            BEQ MAIN_LOOP
            LDA ACIA_DATA
            JMP FLUSH_RX

; ------------------------------------------------------------------------------
; Main Polling Loop: Full duplex check on Keyboard & Serial ACIA
; ------------------------------------------------------------------------------
MAIN_LOOP:
            ; 1. Check Keyboard
            LDA KBD
            BPL CHECK_SERIAL    ; High bit clear = No key pressed

            ; Key was pressed
            STA KBDSTRB         ; Clear keyboard strobe
            AND #$7F            ; Convert Apple ASCII (high-bit set) to 7-bit ASCII

            ; Check if ESC key ($1B) was pressed to exit
            CMP #$1B
            BEQ EXIT_CLIENT

            ; Transmit key over ACIA
            JSR TX_CHAR

            ; Handle local Enter echo
            CMP #$0D
            BNE CHECK_SERIAL
            JSR CROUT

CHECK_SERIAL:
            ; 2. Check ACIA Serial Receive
            LDA ACIA_STATUS
            AND #$08            ; Bit 3: 1 = RX buffer full
            BEQ MAIN_LOOP

            ; Read received byte
            LDA ACIA_DATA
            AND #$7F            ; 7-bit ASCII
            BEQ MAIN_LOOP       ; Ignore NULLs

            ; Skip Line Feed ($0A) to prevent double lines
            CMP #$0A
            BEQ MAIN_LOOP

            ; Print to Apple II screen
            ORA #$80            ; Set high bit for Apple II video display
            JSR COUT

            JMP MAIN_LOOP

; ------------------------------------------------------------------------------
; Subroutine: Transmit Character in Accumulator
; ------------------------------------------------------------------------------
TX_CHAR:
            PHA
WAIT_TX:
            LDA ACIA_STATUS
            AND #$10            ; Bit 4: 1 = Transmitter Data Register Empty
            BEQ WAIT_TX
            PLA
            STA ACIA_DATA       ; Write to ACIA transmit register
            RTS

; ------------------------------------------------------------------------------
; Exit cleanly back to Applesoft BASIC / DOS
; ------------------------------------------------------------------------------
EXIT_CLIENT:
            JSR CROUT
            LDX #0
PRINT_EXIT:
            LDA EXIT_MSG,X
            BEQ DONE
            JSR COUT
            INX
            BNE PRINT_EXIT
DONE:
            JSR CROUT
            RTS

; ------------------------------------------------------------------------------
; Messages
; ------------------------------------------------------------------------------
BANNER_MSG:
            .BYTE $8D
            .BYTE "=== APPLE //e 6502 SERIAL WEB CLIENT ===",$8D
            .BYTE "SUPER SERIAL CARD SLOT 2 @ 9600 BAUD",$8D
            .BYTE "PRESS [ESC] TO EXIT TO BASIC",$8D
            .BYTE "========================================",$8D,$8D,$00

EXIT_MSG:
            .BYTE "CLIENT TERMINATED. RETURN TO BASIC.",$8D,$00
