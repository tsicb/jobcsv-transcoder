(() => {
  'use strict';

  const state = {
    masters: null,
    config: null,
    indexes: null,
    file: null,
    detectedEncoding: 'UTF8',
    selectedColumns: new Set(),
    isProcessing: false,
    lastErrors: [],
    lastLogCsv: '',
  };

  const els = {
    file: document.getElementById('csvFile'),
    fileName: document.getElementById('fileName'),
    dropZone: document.getElementById('dropZone'),
    openColumnModal: document.getElementById('openColumnModal'),
    columnModal: document.getElementById('columnModal'),
    closeColumnModal: document.getElementById('closeColumnModal'),
    applyColumnModal: document.getElementById('applyColumnModal'),
    selectAllColumns: document.getElementById('selectAllColumns'),
    clearAllColumns: document.getElementById('clearAllColumns'),
    columnList: document.getElementById('columnList'),
    columnSummary: document.getElementById('columnSummary'),
    breakModeBlock: document.getElementById('breakModeBlock'),
    breakModeNote: document.getElementById('breakModeNote'),
    downloadLink: document.getElementById('downloadLink'),
    downloadLogButton: document.getElementById('downloadLogButton'),
    status: document.getElementById('status'),
    summary: document.getElementById('summary'),
    errorSection: document.getElementById('errorSection'),
    errorTableBody: document.querySelector('#errorTable tbody'),
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    try {
      setStatus('マスタを読み込んでいます...');
      const [mastersRes, configRes] = await Promise.all([
        fetch('data/masters.json'),
        fetch('data/transform-config.json'),
      ]);
      if (!mastersRes.ok) throw new Error(`masters.jsonを読み込めませんでした: ${mastersRes.status}`);
      if (!configRes.ok) throw new Error(`transform-config.jsonを読み込めませんでした: ${configRes.status}`);
      state.masters = await mastersRes.json();
      state.config = await configRes.json();
      state.indexes = buildIndexes(state.masters.masters);
      state.selectedColumns = new Set(state.config.mappings.map(m => m.inputColumn));
      renderColumnSelector();
      updateColumnSummary();
      updateBreakModeState();
      const sjisStatus = hasEncodingLib() ? '準備完了。CSVをアップロードしてください。' : '準備完了。ただし、Shift_JIS出力には外部ライブラリの読み込みが必要です。';
      setStatus(sjisStatus);
    } catch (err) {
      console.error(err);
      setStatus(`初期化エラー: ${err.message}`);
    }
  }

  function bindEvents() {
    els.file.addEventListener('change', () => {
      const file = els.file.files && els.file.files[0] ? els.file.files[0] : null;
      if (file) handleFileSelected(file);
    });
    els.downloadLogButton.addEventListener('click', () => downloadLogCsv());
    document.querySelectorAll('input[name="direction"]').forEach(input => {
      input.addEventListener('change', updateBreakModeState);
    });

    els.openColumnModal.addEventListener('click', openColumnModal);
    els.closeColumnModal.addEventListener('click', closeColumnModal);
    els.applyColumnModal.addEventListener('click', closeColumnModal);
    els.columnModal.addEventListener('click', (ev) => {
      if (ev.target && ev.target.matches('[data-close-modal]')) closeColumnModal();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeColumnModal();
    });
    els.selectAllColumns.addEventListener('click', () => setAllColumns(true));
    els.clearAllColumns.addEventListener('click', () => setAllColumns(false));

    ['dragenter', 'dragover'].forEach(type => {
      els.dropZone.addEventListener(type, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        els.dropZone.classList.add('dragOver');
      });
    });
    ['dragleave', 'drop'].forEach(type => {
      els.dropZone.addEventListener(type, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        els.dropZone.classList.remove('dragOver');
      });
    });
    els.dropZone.addEventListener('drop', (ev) => {
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0] ? ev.dataTransfer.files[0] : null;
      if (file) handleFileSelected(file);
    });
  }

  function handleFileSelected(file) {
    state.file = file;
    els.fileName.textContent = `${file.name} (${formatBytes(file.size)})`;
    els.file.value = '';
    clearResult();
    if (!state.masters || !state.config || !state.indexes) {
      setStatus('マスタ読み込み後に自動変換します。');
      return;
    }
    runConversion();
  }

  function clearResult() {
    revokeDownloadLink();
    els.downloadLink.classList.add('hidden');
    els.downloadLogButton.classList.add('hidden');
    els.errorSection.classList.add('hidden');
    els.errorTableBody.innerHTML = '';
    els.summary.innerHTML = '';
    state.lastErrors = [];
    state.lastLogCsv = '';
  }

  async function runConversion() {
    if (!state.file || state.isProcessing) return;
    state.isProcessing = true;
    try {
      clearResult();
      setStatus('CSVを読み込んでいます...');
      const direction = getRadioValue('direction');
      const outputMode = getRadioValue('outputMode');
      const decodeBreakMode = getRadioValue('decodeBreakMode') || 'br';
      const requestedInputEncoding = 'auto';
      const requestedOutputEncoding = 'same';

      const buffer = await state.file.arrayBuffer();
      const readResult = decodeArrayBuffer(buffer, requestedInputEncoding);
      state.detectedEncoding = readResult.encoding;
      const parsed = parseCsv(readResult.text);
      if (!parsed.headers.length) throw new Error('CSVのヘッダー行を読み取れませんでした。');

      setStatus('変換しています...');
      const result = transformTable(parsed.headers, parsed.rows, direction, outputMode, decodeBreakMode);
      const finalText = stringifyCsv(result.headers, result.rows);
      const outputEncoding = chooseOutputEncoding(requestedOutputEncoding, state.detectedEncoding);
      const blob = encodeTextToBlob(finalText, outputEncoding);
      const suffix = direction === 'decode' ? 'decoded' : 'encoded';
      const outputName = makeOutputName(state.file.name, suffix, outputEncoding);

      setDownload(blob, outputName, true);
      renderSummary({
        inputRows: parsed.rows.length,
        inputCols: parsed.headers.length,
        outputCols: result.headers.length,
        changedCells: result.changedCells,
        warningCount: result.errors.length,
        inputEncoding: state.detectedEncoding,
        outputEncoding,
        breakMode: displayBreakMode(direction, decodeBreakMode),
      });
      renderErrors(result.errors);
      setStatus(`変換完了。ダウンロードが始まらない場合は「変換済CSVを再ダウンロード」を押してください。`);
    } catch (err) {
      console.error(err);
      setStatus(`処理エラー: ${err.message}`);
    } finally {
      state.isProcessing = false;
    }
  }

  function updateBreakModeState() {
    const direction = getRadioValue('direction');
    const disabled = direction === 'encode';
    document.querySelectorAll('input[name="decodeBreakMode"]').forEach(input => {
      input.disabled = disabled;
    });
    if (els.breakModeBlock) els.breakModeBlock.classList.toggle('disabledControl', disabled);
    if (els.breakModeNote) {
      els.breakModeNote.textContent = disabled
        ? '日本語→コードでは、改行は自動で <BR> に変換されます'
        : 'コード→日本語のときだけ選べます';
    }
  }

  function renderColumnSelector() {
    els.columnList.innerHTML = '';
    if (!state.config) return;
    for (const mapping of state.config.mappings) {
      const master = state.masters.masters[mapping.masterId];
      const label = document.createElement('label');
      label.className = 'checkItem';
      const note = makeColumnNote(mapping, master);
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(mapping.inputColumn)}" checked>
        <span><strong>${escapeHtml(mapping.inputColumn)}</strong><small>${escapeHtml(note)}</small></span>
      `;
      const checkbox = label.querySelector('input');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedColumns.add(mapping.inputColumn);
        else state.selectedColumns.delete(mapping.inputColumn);
        updateColumnSummary();
      });
      els.columnList.appendChild(label);
    }
  }

  function makeColumnNote(mapping, master) {
    const parts = [];
    parts.push(master ? master.name : mapping.masterId);
    parts.push(mapping.multi ? '複数値あり' : '単一値');
    if (mapping.inputSubCodeColumn) parts.push(`${mapping.inputSubCodeColumn}もセットで変換`);
    return parts.join(' / ');
  }

  function updateColumnSummary() {
    if (!state.config) return;
    const total = state.config.mappings.length;
    const selected = state.selectedColumns.size;
    els.columnSummary.textContent = `${total}項目中 ${selected}項目を変換します`;
  }

  function setAllColumns(checked) {
    state.selectedColumns = checked ? new Set(state.config.mappings.map(m => m.inputColumn)) : new Set();
    els.columnList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
    updateColumnSummary();
  }

  function openColumnModal() {
    els.columnModal.classList.remove('hidden');
  }

  function closeColumnModal() {
    els.columnModal.classList.add('hidden');
  }

  function transformTable(headers, rows, direction, outputMode, decodeBreakMode) {
    const selectedMappings = state.config.mappings.filter(m => state.selectedColumns.has(m.inputColumn));
    const mappings = selectedMappings.filter(m => headers.includes(m.inputColumn));
    const missingMappings = selectedMappings.filter(m => !headers.includes(m.inputColumn));
    const errors = [];
    const outputRows = [];
    let changedCells = 0;

    if (missingMappings.length) {
      for (const m of missingMappings) {
        errors.push({ row: '-', column: m.inputColumn, input: '', reason: '入力CSVに対象列がありません', candidates: '' });
      }
    }

    const transformTargets = collectTransformTargets(mappings);
    const outputHeaders = outputMode === 'append' ? buildAppendHeaders(headers, transformTargets) : headers.slice();

    rows.forEach((row, rowIndex) => {
      const originalRow = { ...row };
      const transformed = {};
      const rowErrors = [];

      for (const mapping of mappings) {
        const before = originalRow[mapping.inputColumn] ?? '';
        const conv = convertCell(before, mapping, originalRow, direction, rowIndex + 2);
        transformed[mapping.inputColumn] = conv.value;
        if (conv.changed) changedCells++;
        rowErrors.push(...conv.errors);
        if (conv.extraTargets) {
          for (const [column, value] of Object.entries(conv.extraTargets)) {
            transformed[column] = value;
            const prev = originalRow[column] ?? '';
            if (String(prev) !== String(value)) changedCells++;
          }
        }
      }

      const out = {};
      if (outputMode === 'overwrite') {
        for (const header of headers) {
          out[header] = Object.prototype.hasOwnProperty.call(transformed, header) ? transformed[header] : originalRow[header];
        }
      } else {
        for (const header of headers) {
          out[header] = originalRow[header];
          const afterHeader = transformedHeader(header);
          if (transformTargets.has(header)) {
            out[afterHeader] = Object.prototype.hasOwnProperty.call(transformed, header) ? transformed[header] : originalRow[header];
          }
        }
      }

      for (const header of Object.keys(out)) {
        out[header] = applyBrRule(out[header], direction, decodeBreakMode);
      }

      outputRows.push(out);
      errors.push(...rowErrors);
    });

    return { headers: outputHeaders, rows: outputRows, errors, changedCells };
  }

  function collectTransformTargets(mappings) {
    const set = new Set();
    for (const m of mappings) {
      set.add(m.inputColumn);
      if (m.inputSubCodeColumn) set.add(m.inputSubCodeColumn);
    }
    return set;
  }

  function buildAppendHeaders(headers, transformTargets) {
    const out = [];
    for (const header of headers) {
      out.push(header);
      if (transformTargets.has(header)) out.push(transformedHeader(header));
    }
    return out;
  }

  function transformedHeader(header) {
    return `${header}_変換後`;
  }

  function convertCell(value, mapping, row, direction, rowNumber) {
    if (mapping.masterId === 'municipality') return convertMunicipalityCell(value, mapping, row, direction, rowNumber);
    const master = state.masters.masters[mapping.masterId];
    if (!master) {
      return conversionResult(value, false, [{ row: rowNumber, column: mapping.inputColumn, input: value, reason: `マスタが見つかりません: ${mapping.masterId}`, candidates: '' }]);
    }

    if (mapping.multi) {
      const parts = String(value ?? '').split(state.config.multiDelimiter || '::');
      const errors = [];
      let changed = false;
      const out = parts.map(part => {
        if (part === '') return part;
        const converted = convertSingle(part.trim(), mapping, direction, rowNumber);
        errors.push(...converted.errors);
        if (converted.changed) changed = true;
        return converted.value;
      });
      return conversionResult(out.join(state.config.multiDelimiter || '::'), changed, errors);
    }

    return convertSingle(value, mapping, direction, rowNumber);
  }

  function convertSingle(value, mapping, direction, rowNumber) {
    const raw = String(value ?? '');
    if (raw.trim() === '') return conversionResult(raw, false, []);
    const master = state.masters.masters[mapping.masterId];
    const idx = state.indexes[mapping.masterId];
    if (!master || !idx) {
      return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: `マスタが見つかりません: ${mapping.masterId}`, candidates: '' }]);
    }
    if (master.type === 'station') return convertStation(raw, mapping, direction, rowNumber, idx);
    return convertSimple(raw, mapping, direction, rowNumber, idx);
  }

  function convertSimple(raw, mapping, direction, rowNumber, idx) {
    if (direction === 'decode') {
      const key = normalizeCode(raw);
      const records = idx.byCode.get(key) || [];
      if (!records.length) {
        return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: 'コードがマスタにありません', candidates: '' }]);
      }
      const first = records[0];
      const value = first.value;
      const errors = [];
      if (records.length > 1 && unique(records.map(r => r.value)).length > 1) {
        errors.push({ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '同一コードに複数候補があります。先頭候補を使用しました', candidates: unique(records.map(r => r.value)).join(' / ') });
      }
      return conversionResult(value, value !== raw, errors);
    }

    const key = normalizeValue(raw);
    const records = idx.byValue.get(key) || [];
    if (!records.length) {
      return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '値がマスタにありません', candidates: '' }]);
    }
    const uniqueCodes = unique(records.map(r => r.code));
    if (uniqueCodes.length > 1) {
      return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '値に対して複数コード候補があります', candidates: uniqueCodes.join(' / ') }]);
    }
    return conversionResult(uniqueCodes[0], uniqueCodes[0] !== raw, []);
  }

  function convertStation(raw, mapping, direction, rowNumber, idx) {
    if (direction === 'decode') {
      const key = normalizeCode(raw);
      const records = idx.byCode.get(key) || [];
      if (!records.length) {
        return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '駅コードがマスタにありません', candidates: '' }]);
      }
      const first = records[0];
      const value = first.stationName;
      const errors = [];
      if (records.length > 1 && unique(records.map(r => r.stationName)).length > 1) {
        errors.push({ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '同一駅コードに複数駅名があります。先頭候補を使用しました', candidates: unique(records.map(r => r.stationName)).join(' / ') });
      }
      return conversionResult(value, value !== raw, errors);
    }

    const exactKey = normalizeGeo(raw);
    let records = idx.byExactName.get(exactKey) || [];
    if (!records.length) records = idx.byBaseName.get(exactKey) || [];
    if (!records.length) {
      return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '駅名がマスタにありません', candidates: '' }]);
    }
    const uniqueCodes = unique(records.map(r => r.stationCode));
    if (uniqueCodes.length > 1) {
      const candidates = records.slice(0, 20).map(r => `${r.stationCode}:${r.stationName}`).join(' / ');
      return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '駅名に複数候補があります', candidates }]);
    }
    return conversionResult(uniqueCodes[0], uniqueCodes[0] !== raw, []);
  }

  function convertMunicipalityCell(value, mapping, row, direction, rowNumber) {
    const raw = String(value ?? '');
    if (raw.trim() === '') return conversionResult(raw, false, []);
    const idx = state.indexes.municipality;
    const prefColumn = mapping.inputSubCodeColumn;
    const prefRaw = prefColumn ? String(row[prefColumn] ?? '') : '';
    if (direction === 'decode') {
      const cityCode = normalizeCode(raw);
      const pref = resolvePref(prefRaw);
      if (!pref) {
        return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: `市区町村コードの判定に必要な都道府県を解釈できません: ${prefColumn || '(未指定)'}`, candidates: prefRaw }]);
      }
      const rec = idx.byPrefCityCode.get(`${normalizeCode(pref.code)}|${cityCode}`);
      if (!rec) {
        return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: '都道府県コードと市区町村コードの組み合わせがマスタにありません', candidates: `${pref.code}:${pref.value}` }]);
      }
      return conversionResult(rec.cityName, rec.cityName !== raw, [], { [prefColumn]: rec.prefName });
    }

    const resolved = resolveMunicipalityForEncode(raw, prefRaw, idx);
    if (!resolved.record) {
      return conversionResult(raw, false, [{ row: rowNumber, column: mapping.inputColumn, input: raw, reason: resolved.reason, candidates: resolved.candidates || '' }]);
    }
    const rec = resolved.record;
    return conversionResult(rec.cityCode, rec.cityCode !== raw, [], { [prefColumn]: rec.prefCode });
  }

  function resolveMunicipalityForEncode(cityRaw, prefRaw, idx) {
    const pref = resolvePref(prefRaw);
    let city = String(cityRaw ?? '').trim();
    let prefFromCity = null;

    for (const prefRecord of state.indexes.prefecture.records) {
      const prefName = prefRecord.value;
      if (city.startsWith(prefName)) {
        prefFromCity = prefRecord;
        city = city.slice(prefName.length);
        break;
      }
    }

    const effectivePref = pref || prefFromCity;
    const cityKey = normalizeGeo(city);
    if (effectivePref) {
      const rec = idx.byPrefCityName.get(`${normalizeCode(effectivePref.code)}|${cityKey}`);
      if (rec) return { record: rec };
      return { record: null, reason: '都道府県と市区町村名の組み合わせがマスタにありません', candidates: `${effectivePref.code}:${effectivePref.value}` };
    }

    const records = idx.byCityName.get(cityKey) || [];
    if (!records.length) return { record: null, reason: '市区町村名がマスタにありません', candidates: '' };
    if (records.length > 1) {
      return {
        record: null,
        reason: '市区町村名に複数候補があります。県コード列を入力してください',
        candidates: records.map(r => `${r.prefName}${r.cityName}`).join(' / '),
      };
    }
    return { record: records[0] };
  }

  function resolvePref(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    const idx = state.indexes.prefecture;
    return (idx.byCode.get(normalizeCode(value)) || [])[0] || (idx.byValue.get(normalizeValue(value)) || [])[0] || null;
  }

  function conversionResult(value, changed, errors, extraTargets) {
    return { value: value ?? '', changed: Boolean(changed), errors: errors || [], extraTargets: extraTargets || null };
  }

  function buildIndexes(masters) {
    const indexes = {};
    for (const [id, master] of Object.entries(masters)) {
      if (master.type === 'municipality') {
        indexes[id] = buildMunicipalityIndex(master.records || []);
      } else if (master.type === 'station') {
        indexes[id] = buildStationIndex(master.records || []);
      } else {
        indexes[id] = buildSimpleIndex(master.records || []);
      }
    }
    return indexes;
  }

  function buildSimpleIndex(records) {
    const byCode = new Map();
    const byValue = new Map();
    for (const rec of records) {
      pushMap(byCode, normalizeCode(rec.code), rec);
      pushMap(byValue, normalizeValue(rec.value), rec);
    }
    return { records, byCode, byValue };
  }

  function buildMunicipalityIndex(records) {
    const byPrefCityCode = new Map();
    const byPrefCityName = new Map();
    const byCityName = new Map();
    for (const rec of records) {
      byPrefCityCode.set(`${normalizeCode(rec.prefCode)}|${normalizeCode(rec.cityCode)}`, rec);
      byPrefCityName.set(`${normalizeCode(rec.prefCode)}|${normalizeGeo(rec.cityName)}`, rec);
      pushMap(byCityName, normalizeGeo(rec.cityName), rec);
      if (rec.fullName) pushMap(byCityName, normalizeGeo(rec.fullName), rec);
    }
    return { records, byPrefCityCode, byPrefCityName, byCityName };
  }

  function buildStationIndex(records) {
    const byCode = new Map();
    const byExactName = new Map();
    const byBaseName = new Map();
    for (const rec of records) {
      pushMap(byCode, normalizeCode(rec.stationCode), rec);
      pushMap(byExactName, normalizeGeo(rec.stationName), rec);
      pushMap(byBaseName, normalizeGeo(rec.baseName), rec);
    }
    return { records, byCode, byExactName, byBaseName };
  }

  function pushMap(map, key, value) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }

  function normalizeCode(value) {
    return String(value ?? '').trim().normalize('NFKC');
  }

  function normalizeValue(value) {
    return String(value ?? '').trim().normalize('NFKC');
  }

  function normalizeGeo(value) {
    return normalizeValue(value).replace(/ヶ/g, 'ケ').replace(/ヵ/g, 'カ');
  }

  function unique(arr) {
    return [...new Set(arr.filter(v => v !== undefined && v !== null).map(v => String(v)))];
  }

  function applyBrRule(value, direction, decodeBreakMode) {
    const text = String(value ?? '');
    if (direction === 'decode') {
      if (decodeBreakMode === 'newline') {
        return text.replace(/<br\s*\/?\s*>/gi, '\n');
      }
      return text;
    }
    return text.replace(/\r\n|\r|\n/g, '<BR>');
  }

  function decodeArrayBuffer(buffer, requestedEncoding) {
    const bytes = new Uint8Array(buffer);
    const encoding = requestedEncoding === 'auto' ? detectEncoding(bytes) : requestedEncoding;
    if (encoding === 'SJIS') {
      if (hasEncodingLib()) {
        const unicodeArray = Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS' });
        return { text: Encoding.codeToString(unicodeArray), encoding: 'SJIS' };
      }
      return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'SJIS' };
    }
    return { text: stripBom(new TextDecoder('utf-8').decode(bytes)), encoding: 'UTF8' };
  }

  function detectEncoding(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'UTF8';
    if (hasEncodingLib()) {
      const detected = Encoding.detect(Array.from(bytes));
      if (String(detected).toUpperCase().includes('SJIS') || String(detected).toUpperCase().includes('SHIFT')) return 'SJIS';
      if (String(detected).toUpperCase().includes('UTF')) return 'UTF8';
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return 'UTF8';
    } catch (_) {
      return 'SJIS';
    }
  }

  function chooseOutputEncoding(requested, detected) {
    if (requested === 'same') return detected === 'SJIS' ? 'SJIS' : 'UTF8_BOM';
    return requested;
  }

  function encodeTextToBlob(text, encoding) {
    if (encoding === 'SJIS') {
      if (!hasEncodingLib()) throw new Error('Shift_JISで出力するには、encoding-japaneseライブラリの読み込みが必要です。ネットワーク接続またはCDN設定を確認してください。');
      const unicodeArray = Encoding.stringToCode(text);
      const sjisArray = Encoding.convert(unicodeArray, { to: 'SJIS', from: 'UNICODE' });
      return new Blob([new Uint8Array(sjisArray)], { type: 'text/csv;charset=shift_jis' });
    }
    const utf8 = new TextEncoder().encode(text);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    return new Blob([bom, utf8], { type: 'text/csv;charset=utf-8' });
  }

  function hasEncodingLib() {
    return typeof window.Encoding !== 'undefined' && typeof window.Encoding.convert === 'function';
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(field);
          field = '';
        } else if (ch === '\n') {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else if (ch === '\r') {
          if (text[i + 1] === '\n') i++;
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else {
          field += ch;
        }
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map(stripBom);
    const dataRows = rows.slice(1).filter(r => !(r.length === 1 && r[0] === '')).map(cols => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
      return obj;
    });
    return { headers, rows: dataRows };
  }

  function stringifyCsv(headers, rows) {
    const lines = [];
    lines.push(headers.map(csvEscape).join(','));
    for (const row of rows) {
      lines.push(headers.map(h => csvEscape(row[h] ?? '')).join(','));
    }
    return lines.join('\r\n');
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function getRadioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : '';
  }

  function setDownload(blob, name, autoClick = false) {
    revokeDownloadLink();
    const url = URL.createObjectURL(blob);
    els.downloadLink.href = url;
    els.downloadLink.download = name;
    els.downloadLink.textContent = `変換済CSVを再ダウンロード（${name}）`;
    els.downloadLink.classList.remove('hidden');
    if (autoClick) {
      setTimeout(() => els.downloadLink.click(), 0);
    }
  }

  function revokeDownloadLink() {
    if (els.downloadLink.href && els.downloadLink.href.startsWith('blob:')) URL.revokeObjectURL(els.downloadLink.href);
    els.downloadLink.removeAttribute('href');
  }

  function renderSummary(summary) {
    els.summary.innerHTML = '';
    const items = [
      ['入力行数', summary.inputRows],
      ['入力列数', summary.inputCols],
      ['出力列数', summary.outputCols],
      ['変換セル数', summary.changedCells],
      ['注意件数', summary.warningCount],
      ['入力文字コード', displayEncoding(summary.inputEncoding)],
      ['出力文字コード', displayEncoding(summary.outputEncoding)],
      ['改行の扱い', summary.breakMode],
    ];
    for (const [label, value] of items) {
      const div = document.createElement('div');
      div.className = 'summaryItem';
      div.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
      els.summary.appendChild(div);
    }
  }

  function renderErrors(errors) {
    state.lastErrors = errors;
    state.lastLogCsv = stringifyCsv(['行', '列', '入力値', '理由', '候補'], errors.map(e => ({
      '行': e.row,
      '列': e.column,
      '入力値': e.input,
      '理由': e.reason,
      '候補': e.candidates,
    })));
    if (!errors.length) {
      els.errorSection.classList.add('hidden');
      els.downloadLogButton.classList.add('hidden');
      return;
    }
    els.errorTableBody.innerHTML = '';
    for (const e of errors.slice(0, 300)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(e.row)}</td><td>${escapeHtml(e.column)}</td><td>${escapeHtml(e.input)}</td><td>${escapeHtml(e.reason)}</td><td>${escapeHtml(e.candidates)}</td>`;
      els.errorTableBody.appendChild(tr);
    }
    els.errorSection.classList.remove('hidden');
    els.downloadLogButton.classList.remove('hidden');
  }

  function downloadLogCsv() {
    if (!state.lastLogCsv) return;
    const blob = encodeTextToBlob(state.lastLogCsv, 'UTF8_BOM');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversion_log.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function makeOutputName(name, suffix, encoding) {
    const base = name.replace(/\.csv$/i, '');
    const enc = encoding === 'SJIS' ? 'sjis' : 'utf8bom';
    return `${base}_${suffix}_${enc}.csv`;
  }

  function displayBreakMode(direction, decodeBreakMode) {
    if (direction === 'encode') return '改行 → <BR>';
    return decodeBreakMode === 'newline' ? '<BR> → 改行' : '<BR>のまま';
  }

  function displayEncoding(enc) {
    if (enc === 'SJIS') return 'Shift_JIS / CP932';
    if (enc === 'UTF8_BOM') return 'UTF-8 with BOM';
    if (enc === 'UTF8') return 'UTF-8';
    return enc;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
