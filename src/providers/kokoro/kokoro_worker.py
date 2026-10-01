"""Kokoro TTS worker for Rocket Explainer. Run with the Python of the venv that installKokoro() builds.

  kokoro_worker.py prefetch <model_dir> <revision>   download the model and English voices (needs network)
  kokoro_worker.py serve <model_dir>                 JSON lines on stdin -> JSON lines on stdout (offline)

Serve protocol, one JSON object per line:
  request:  {"id": 1, "text": "...", "voice": "af_heart", "speed": 1.0, "out": "/abs/file.wav"}
  response: {"id": 1, "ok": true, "words": [{"text": "...", "startMs": 0, "endMs": 120}], "samples": 24000}
            {"id": 1, "ok": false, "error": "..."}
The first line written is {"ready": true} once the model is loaded. Logs go to stderr.
"""
import json
import os
import shutil
import sys
import tempfile

SAMPLE_RATE = 24000


def prefetch(model_dir, revision):
    from huggingface_hub import snapshot_download
    snapshot_download(
        repo_id='hexgrad/Kokoro-82M', revision=revision, local_dir=model_dir,
        allow_patterns=['config.json', 'kokoro-v1_0.pth', 'voices/a*.pt', 'voices/b*.pt'],
    )


def fix_espeak_data_path():
    # espeak-ng silently ignores (then exits on) a data path longer than ~160 chars, which a deep
    # data dir easily reaches. Copy the data somewhere short when that happens.
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    import misaki.espeak  # noqa: F401  (sets the library and the long data path)
    data = espeakng_loader.get_data_path()
    if len(data) < 150:
        return
    short = os.path.join(tempfile.gettempdir(), f'rocket-explainer-espeak-ng-data-{os.getuid()}')
    if not os.path.isfile(os.path.join(short, 'phontab')):
        shutil.rmtree(short, ignore_errors=True)
        shutil.copytree(data, short)
    EspeakWrapper.set_data_path(short)


def words_from_tokens(tokens, offset_s):
    """Kokoro tokens (spaCy-style, punctuation split off) -> whitespace-delimited words with times."""
    # A trailing punctuation token's span covers the pause after it, so a word ends where its last
    # spoken (alphanumeric) token ends; punctuation counts only when the word has nothing else.
    words, cur = [], None
    for t in tokens:
        if cur is None:
            cur = {'text': '', 'start': None, 'end': None, 'spoken_end': None}
        cur['text'] += t.text
        if t.start_ts is not None and cur['start'] is None:
            cur['start'] = t.start_ts
        if t.end_ts is not None:
            cur['end'] = t.end_ts
            if any(ch.isalnum() for ch in t.text):
                cur['spoken_end'] = t.end_ts
        if t.whitespace:
            words.append(cur)
            cur = None
    if cur is not None:
        words.append(cur)
    out = []
    for w in words:
        if not w['text'].strip():
            continue
        start = w['start'] if w['start'] is not None else (w['end'] if w['end'] is not None else None)
        end = next((e for e in (w['spoken_end'], w['end']) if e is not None), start)
        out.append({'text': w['text'], 'start': start, 'end': end, 'offset': offset_s})
    return out


def serve(model_dir):
    import warnings
    warnings.filterwarnings('ignore')
    fix_espeak_data_path()
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KModel, KPipeline

    model = KModel(repo_id='hexgrad/Kokoro-82M', config=os.path.join(model_dir, 'config.json'),
                   model=os.path.join(model_dir, 'kokoro-v1_0.pth')).eval()
    pipelines = {}

    def pipeline(lang):
        if lang not in pipelines:
            pipelines[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M', model=model)
        return pipelines[lang]

    pipeline('a')  # warm up the US English G2P (spaCy) too
    out = sys.stdout
    out.write(json.dumps({'ready': True}) + '\n')
    out.flush()

    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            voice = req['voice']
            p = pipeline(voice[0])
            chunks, words, at = [], [], 0
            with torch.no_grad():
                for r in p(req['text'], voice=os.path.join(model_dir, 'voices', f'{voice}.pt'), speed=float(req.get('speed', 1.0))):
                    if r.audio is None:
                        continue
                    audio = r.audio.numpy()
                    words += words_from_tokens(r.tokens or [], at / SAMPLE_RATE)
                    chunks.append(audio)
                    at += len(audio)
            if not chunks:
                raise RuntimeError('Kokoro produced no audio')
            sf.write(req['out'], np.concatenate(chunks), SAMPLE_RATE, subtype='PCM_16')
            # Absolute times; words Kokoro gave no timing get their neighbour's (fixed up in TS).
            timed = [{'text': w['text'],
                      'startMs': None if w['start'] is None else round((w['offset'] + w['start']) * 1000),
                      'endMs': None if w['end'] is None else round((w['offset'] + w['end']) * 1000)} for w in words]
            res = {'id': req.get('id'), 'ok': True, 'words': timed, 'samples': at}
        except Exception as e:  # report and keep serving
            res = {'id': req.get('id'), 'ok': False, 'error': f'{type(e).__name__}: {e}'}
        out.write(json.dumps(res) + '\n')
        out.flush()


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'prefetch':
        prefetch(sys.argv[2], sys.argv[3])
    elif cmd == 'serve':
        serve(sys.argv[2])
    else:
        sys.exit(__doc__)
