// pdftool pages <pdf> <outDir>        -> page-N.png at 2x (white background) + pages.json {count, pages:[{w,h,text}]}
// pdftool diff <a.png> <b.png> <out.png> -> prints JSON {w,h,sameSize,diffPixels,maxDelta}; out.png = b dimmed, changed pixels red
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func writePNG(_ img: CGImage, _ path: String) {
  let url = URL(fileURLWithPath: path) as CFURL
  let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

func rgba(_ img: CGImage) -> (Int, Int, [UInt8]) {
  let w = img.width, h = img.height
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  return (w, h, buf)
}

func loadPNG(_ path: String) -> CGImage {
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil)!
  return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}

let args = CommandLine.arguments
if args[1] == "pages" {
  let doc = PDFDocument(url: URL(fileURLWithPath: args[2]))!
  let out = args[3]
  try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
  var pages: [[String: Any]] = []
  for i in 0..<doc.pageCount {
    let page = doc.page(at: i)!
    let box = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2
    let w = Int(box.width * scale), h = Int(box.height * scale)
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    writePNG(ctx.makeImage()!, "\(out)/page-\(i + 1).png")
    // lowest / highest text line on the page (PDF points from the top edge) -> how full the page is
    var top = CGFloat.greatestFiniteMagnitude, bottom: CGFloat = 0
    if let sel = page.selection(for: box) {
      for line in sel.selectionsByLine() {
        let b = line.bounds(for: page)
        if b.width < 1 || b.height < 1 { continue }
        top = min(top, box.height - b.maxY); bottom = max(bottom, box.height - b.minY)
      }
    }
    pages.append(["w": box.width, "h": box.height, "text": page.string ?? "", "textTop": top == CGFloat.greatestFiniteMagnitude ? -1 : top, "textBottom": bottom])
  }
  let json = try! JSONSerialization.data(withJSONObject: ["count": doc.pageCount, "pages": pages], options: [.prettyPrinted])
  try! json.write(to: URL(fileURLWithPath: "\(out)/pages.json"))
  print("{\"count\": \(doc.pageCount)}")
} else if args[1] == "diff" {
  let (aw, ah, a) = rgba(loadPNG(args[2]))
  let (bw, bh, b) = rgba(loadPNG(args[3]))
  let w = max(aw, bw), h = max(ah, bh)
  var out = [UInt8](repeating: 255, count: w * h * 4)
  var diff = 0, maxDelta = 0
  for y in 0..<h {
    for x in 0..<w {
      let o = (y * w + x) * 4
      let inA = x < aw && y < ah, inB = x < bw && y < bh
      var d = 255
      if inA && inB {
        let ia = (y * aw + x) * 4, ib = (y * bw + x) * 4
        d = max(abs(Int(a[ia]) - Int(b[ib])), abs(Int(a[ia + 1]) - Int(b[ib + 1])), abs(Int(a[ia + 2]) - Int(b[ib + 2])))
      }
      if d > 0 { diff += 1; maxDelta = max(maxDelta, d) }
      if d > 8 {
        out[o] = 230; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255
      } else if inB {
        let ib = (y * bw + x) * 4
        for c in 0..<3 { out[o + c] = UInt8(200 + Int(b[ib + c]) * 55 / 255) }
        out[o + 3] = 255
      }
    }
  }
  let ctx = CGContext(data: &out, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  writePNG(ctx.makeImage()!, args[4])
  print("{\"w\": \(w), \"h\": \(h), \"sameSize\": \(aw == bw && ah == bh), \"diffPixels\": \(diff), \"maxDelta\": \(maxDelta)}")
}
