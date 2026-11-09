#!/bin/zsh
# Turn every .md in one task's progress folder into a PDF next to it.
#   进度/pdf.sh 进度/B          (or: cd 进度 && ./pdf.sh B)
# Chinese must be embedded as Heiti SC TrueType: PingFang gets embedded as
# CFF, which shows as garbage on Billy's machine. pdf.css forces Heiti on
# everything; the check at the end fails if any other CJK font slipped in.
# Images are found relative to the .md file (put them in the same folder).
set -e
here=${0:A:h}
dir=${1:?usage: pdf.sh <task folder>}
[[ -d $dir ]] || dir=$here/$dir
dir=${dir:A}
tmp=$(mktemp -d)
for md in $dir/*.md(N); do
  out=${md:r}.pdf
  # A list straight after a paragraph line needs a blank line for pandoc.
  python3 -c "
import re,sys
s=open(sys.argv[1]).read()
s=re.sub(r'(?m)^(?!\s*[-*\d|>#]|\s*$)(.+)\n(?=\s*(?:- |\d+\. ))', r'\1\n\n', s)
open(sys.argv[2],'w').write(s)" $md $tmp/src.md
  pandoc $tmp/src.md -f markdown -t html5 -s --syntax-highlighting=none --css $here/pdf.css --metadata title=" " -o $tmp/doc.html
  sed -i '' 's|<header id="title-block-header">.*</header>||' $tmp/doc.html
  weasyprint -u "$dir/" $tmp/doc.html $out 2>&1 | grep -v WARNING || true
  bad=$(pdffonts $out | tail -n +3 | grep -v -E 'Heiti|Menlo' || true)
  if [[ -n $bad ]]; then echo "font problem in $out:"; echo $bad; exit 1; fi
  echo "ok ${out:t} ($(pdfinfo $out | awk '/Pages/{print $2}') pages, Heiti TrueType)"
done
rm -rf $tmp
