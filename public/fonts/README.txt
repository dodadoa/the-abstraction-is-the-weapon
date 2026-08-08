Drop the Mesa 0.43 font file(s) in this folder, named:

  Mesa043.woff2   (preferred)
  Mesa043.otf
  Mesa043.ttf

Any one of the three is enough — the @font-face rule in app/globals.css
tries them in that order. Until a file is present, the game falls back to
the system monospace stack (ui-monospace / Menlo / Consolas).

The font applies to the whole instrument HUD (readouts, drone feed,
sequencer labels, gate screen). The mode-3 TaskQueue console keeps the
system sans-serif on purpose — its blandness is part of the piece.
