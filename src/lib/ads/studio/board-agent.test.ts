import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('./assets', () => ({ listAssets: vi.fn(), loadAssessments: vi.fn(), assetJpeg: vi.fn() }));
vi.mock('./uploads', () => ({ addUpload: vi.fn() }));
vi.mock('./server-draw', () => ({ settleBoard: vi.fn(async () => []) }));
vi.mock('./board', () => ({ changeBoard: vi.fn(), createBoard: vi.fn(), getBoard: vi.fn(), getView: vi.fn(), listBoards: vi.fn(), viewRevs: vi.fn() }));

const { wordProblems, TOOLS, callTool, decodePicture, MAX_UPLOAD_BYTES } = await import('./board-agent');
const { addUpload } = await import('./uploads');
const { listAssets } = await import('./assets');
const { getBoard, changeBoard } = await import('./board');

const f = (fields: Partial<Record<'kicker' | 'headline' | 'weight' | 'details', string>>) => ({ fields: { kicker: '', headline: '', weight: '', details: '', ...fields }, doc: null });

describe('an agent’s words', () => {
  it('passes words with only the ERP’s figures', () => {
    expect(wordProblems(f({ headline: 'An emerald for Eid', weight: '21K Yellow Gold · 4.2g', details: 'Message us' }))).toEqual([]);
    expect(wordProblems(f({ headline: 'Only 4.2g of 21K gold', weight: '21K Yellow Gold · 4.2g' }))).toEqual([]);
  });

  it('refuses a figure the ERP didn’t give, sale words and hashtags', () => {
    expect(wordProblems(f({ headline: '22K, just 5g', weight: '21K Yellow Gold · 4.2g' })).join(' ')).toMatch(/didn't give/);
    expect(wordProblems(f({ headline: 'Eid sale on now' })).join(' ')).toMatch(/sale\/discount/);
    expect(wordProblems(f({ details: 'Shop now #eid' })).join(' ')).toMatch(/hashtag/);
  });

  it('offers every tool with an object schema', () => {
    expect(TOOLS.map(t => t.name)).toContain('view_design');
    for (const t of TOOLS) expect(t.inputSchema.type).toBe('object');
  });
});

const jpeg = Buffer.from('/9j/4AAQSkZJRg==', 'base64');
const body = (r: { content: { type: string; text?: string }[] }) => r.content[0].text ?? '';

describe('upload_photo', () => {
  it('is offered', () => expect(TOOLS.map(t => t.name)).toEqual(expect.arrayContaining(['upload_photo', 'replace_design_photo'])));

  it('decodes base64, a data URL and url-safe base64', () => {
    expect(decodePicture(jpeg.toString('base64')).equals(jpeg)).toBe(true);
    expect(decodePicture(`data:image/jpeg;base64,${jpeg.toString('base64')}`).equals(jpeg)).toBe(true);
    expect(decodePicture(Buffer.from([0xfb, 0xff, 0xfe]).toString('base64url')).length).toBe(3);
  });

  it('refuses bad base64, nothing, and too big', async () => {
    expect(() => decodePicture('not base64 !!!')).toThrow(/base64/);
    expect(() => decodePicture('')).toThrow(/needs/);
    expect(() => decodePicture(undefined)).toThrow(/needs/);
    expect(() => decodePicture('A'.repeat(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8))).toThrow(/over 20 MB/);
    const r = await callTool('upload_photo', { data: '***' }, 'k');
    expect(r.isError).toBe(true);
    expect(addUpload).not.toHaveBeenCalled();
  });

  it('refuses a mime that is not an image', async () => {
    const r = await callTool('upload_photo', { data: jpeg.toString('base64'), mime: 'application/pdf' }, 'k');
    expect(r.isError).toBe(true);
    expect(addUpload).not.toHaveBeenCalled();
  });

  it('passes a non-picture rejection through as a tool error', async () => {
    vi.mocked(addUpload).mockRejectedValueOnce(Object.assign(new Error('That file isn’t a picture.'), { status: 400 }));
    await expect(callTool('upload_photo', { data: Buffer.from('hello').toString('base64') }, 'k')).rejects.toThrow(/isn’t a picture/);
  });

  it('stores via addUpload and answers the library id', async () => {
    vi.mocked(addUpload).mockResolvedValueOnce({ id: 'abc', name: 'ring', collection: 'Uploads', w: 800, h: 600, added: 1, specs: '', page: null });
    const r = await callTool('upload_photo', { data: jpeg.toString('base64'), filename: 'ring.jpg' }, 'key1');
    expect(addUpload).toHaveBeenCalledWith(expect.any(Buffer), { name: 'ring.jpg', by: 'agent:key1' });
    expect(JSON.parse(body(r))).toMatchObject({ id: 'up:abc', w: 800, h: 600 });
  });
});

describe('replace_design_photo', () => {
  const doc = {
    bg: { photoId: 'photo', placement: { mode: 'fill', zoom: 1.4, focusX: 0.3, focusY: 0.6 }, dim: 0.2 },
    layers: [
      { id: 't1', kind: 'text', text: 'Hello', x: 10, y: 20 },
      { id: 'i1', kind: 'image', photoId: 'lib:up:old', x: 5, y: 5, w: 100, fx: 0.4, fy: 0.5, iz: 1.2 },
    ],
    frame: { w: 1080, h: 1350 },
  };
  const frame = { id: 'f1', label: 'L', format: 'portrait', assetId: 'site:old', marked: true, template: 'framed', fields: { kicker: 'K', headline: 'H', weight: 'W', details: 'D' }, doc, by: 'page', rev: 3 };
  const setup = () => {
    vi.mocked(getBoard).mockResolvedValue({ id: 'b1', name: 'B', frames: [frame], notes: [], rev: 1, updated: '', by: '' } as never);
    vi.mocked(listAssets).mockResolvedValue({ assets: [{ id: 'up:new', source: 'upload', original: null }, { id: 'site:m', source: 'site', original: { id: 'drive:o' } }] } as never);
    vi.mocked(changeBoard).mockClear();
  };

  it('swaps only the photo; the doc is left alone', async () => {
    setup();
    const r = await callTool('replace_design_photo', { board: 'b1', id: 'f1', photo: 'up:new' }, 'k');
    expect(r.isError).toBeUndefined();
    const ops = vi.mocked(changeBoard).mock.calls[0][1] as { op: string; id: string; patch: Record<string, unknown> }[];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'put', id: 'f1', patch: { assetId: 'up:new', marked: false, by: 'agent' } });
    expect(ops[0].patch).not.toHaveProperty('doc');
    expect(ops[0].patch).not.toHaveProperty('fields');
    expect(ops[0].patch).not.toHaveProperty('template');
  });

  it('uses a site photo’s unmarked original', async () => {
    setup();
    await callTool('replace_design_photo', { board: 'b1', id: 'f1', photo: 'site:m' }, 'k');
    const ops = vi.mocked(changeBoard).mock.calls[0][1] as { patch: Record<string, unknown> }[];
    expect(ops[0].patch).toMatchObject({ assetId: 'drive:o', marked: false });
  });

  it('replaces an image layer, keeping its place and the other layers; its crop starts centred', async () => {
    setup();
    await callTool('replace_design_photo', { board: 'b1', id: 'f1', photo: 'up:new', layer: 'i1' }, 'k');
    const ops = vi.mocked(changeBoard).mock.calls[0][1] as { patch: { doc: typeof doc; assetId?: string } }[];
    const d = ops[0].patch.doc;
    expect(d.layers[1]).toMatchObject({ photoId: 'lib:up:new', x: 5, w: 100, fx: 0.5, fy: 0.5 });
    expect(d.layers[1]).not.toHaveProperty('iz');
    expect(d.layers[0]).toEqual(doc.layers[0]);
    expect(d.bg).toEqual(doc.bg);
  });

  it('refuses unknown design, photo, layer and board', async () => {
    setup();
    expect((await callTool('replace_design_photo', { board: 'b1', id: 'nope', photo: 'up:new' }, 'k')).isError).toBe(true);
    expect((await callTool('replace_design_photo', { board: 'b1', id: 'f1', photo: 'up:missing' }, 'k')).isError).toBe(true);
    expect((await callTool('replace_design_photo', { board: 'b1', id: 'f1', photo: 'up:new', layer: 'zzz' }, 'k')).isError).toBe(true);
    vi.mocked(getBoard).mockResolvedValue(null as never);
    await expect(callTool('replace_design_photo', { board: 'gone', id: 'f1', photo: 'up:new' }, 'k')).rejects.toThrow(/No board/);
    expect(changeBoard).not.toHaveBeenCalled();
  });
});
