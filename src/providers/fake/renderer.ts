import { copyFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import type { Renderer, RenderRequest, RenderResult } from '../types.ts';
import { ffmpeg } from '../../media.ts';

function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return '0x' + (h & 0xffffff).toString(16).padStart(6, '0');
}

async function exists(f: string) { try { await access(f); return true; } catch { return false; } }

/** Tiny real MP4s (one flat colour per scene) with the scenes' audio. For tests. */
export function createFakeVideoRenderer(): Renderer {
  return {
    id: 'fake',
    label: 'Fake renderer (for tests)',
    outputTypes: ['video'],
    async render(req: RenderRequest): Promise<RenderResult> {
      await mkdir(req.workdir, { recursive: true });
      const rendered: string[] = [];
      const clips: string[] = [];
      for (const scene of req.scenes) {
        const clip = join(req.workdir, `scene-${scene.id}.mp4`);
        const cached = req.cacheDir ? join(req.cacheDir, `scene-${scene.id}.mp4`) : '';
        const dirty = !req.dirtyScenes || req.dirtyScenes.includes(scene.id);
        if (!dirty && cached && await exists(cached)) {
          if (cached !== clip) await copyFile(cached, clip);
        } else {
          req.onScene?.(scene.id, clips.length, req.scenes.length);
          const secs = (scene.durationMs / 1000).toFixed(3);
          const audio = scene.audioFile ? ['-i', scene.audioFile] : ['-f', 'lavfi', '-t', secs, '-i', 'anullsrc=r=16000:cl=mono'];
          await ffmpeg(['-f', 'lavfi', '-i', `color=c=${colorFor(scene.id)}:s=320x180:r=10:d=${secs}`, ...audio,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '1', '-t', secs, clip], { signal: req.signal });
          rendered.push(scene.id);
          req.onLog?.(`rendered scene ${scene.id} (${secs}s)`);
        }
        clips.push(clip);
      }
      const list = join(req.workdir, 'concat.txt');
      await writeFile(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
      const out = join(req.workdir, 'output.mp4');
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal: req.signal });
      const durationMs = req.scenes.reduce((s, x) => s + x.durationMs, 0);
      return { primary: out, files: [out], durationMs, sceneCount: req.scenes.length, rendered };
    },
  };
}

/** Minimal stored (uncompressed) ZIP, enough for a file that opens as a zip. */
function zipStore(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A one-page PDF with a line of text per scene title. */
function tinyPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 18 Tf 72 720 Td ${lines.map((l, i) => `${i ? '0 -28 Td ' : ''}(${esc(l)}) Tj`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Fake deck/doc/visual: tiny but valid files of each declared type. For tests. */
export function createFakeDocumentRenderer(): Renderer {
  return {
    id: 'fake',
    label: 'Fake renderer (for tests)',
    outputTypes: ['deck', 'doc', 'visual'],
    async render(req: RenderRequest): Promise<RenderResult> {
      await mkdir(req.workdir, { recursive: true });
      const sections = req.scenes.map((s, i) => { req.onScene?.(s.id, i, req.scenes.length); return s; });
      const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(req.title)}</title></head><body>${body}</body></html>\n`;
      const rendered = req.dirtyScenes ?? req.scenes.map((s) => s.id);
      if (req.outputType === 'deck') {
        const deck = join(req.workdir, 'deck.html');
        await writeFile(deck, html(sections.map((s) => `<section class="slide" data-scene="${s.id}"><h1>${escHtml(s.title)}</h1><p>${escHtml(s.narration)}</p></section>`).join('\n')));
        const pptx = join(req.workdir, 'deck.pptx');
        await writeFile(pptx, zipStore([['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'], ...sections.map((s, i): [string, string] => [`ppt/slides/slide${i + 1}.xml`, `<p:sld><!-- ${s.id} ${s.title} --></p:sld>`])]));
        return { primary: deck, files: [deck, pptx], sceneCount: sections.length, rendered };
      }
      if (req.outputType === 'doc') {
        const md = join(req.workdir, 'doc.md');
        await writeFile(md, `# ${req.title}\n\n${sections.map((s) => `## ${s.title}\n\n${s.narration}\n`).join('\n')}`);
        const pdf = join(req.workdir, 'doc.pdf');
        await writeFile(pdf, tinyPdf([req.title, ...sections.map((s) => s.title)]));
        return { primary: pdf, files: [pdf, md], sceneCount: sections.length, rendered };
      }
      const page = join(req.workdir, 'visual.html');
      await writeFile(page, html(sections.map((s) => `<div class="panel" data-scene="${s.id}"><h2>${escHtml(s.title)}</h2></div>`).join('')));
      const png = join(req.workdir, 'visual.png');
      await ffmpeg(['-f', 'lavfi', '-i', `color=c=${colorFor(req.title)}:s=320x240`, '-frames:v', '1', png]);
      return { primary: png, files: [png, page], sceneCount: sections.length, rendered };
    },
  };
}
