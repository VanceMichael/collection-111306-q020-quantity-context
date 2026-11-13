import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as domain from '../src/domain.mjs';
const data=JSON.parse(await readFile(new URL('../fixtures/source.json',import.meta.url))).data;
const {rawText,preview}=domain;
test('资料对象的领域边界和原始预览',async()=>{assert.ok(preview(data)[0].text.includes('1.2～1.5'));assert.ok(preview(data)[0].text.includes('不少于'));assert.equal(rawText('<p>待定</p>'),'待定');});
