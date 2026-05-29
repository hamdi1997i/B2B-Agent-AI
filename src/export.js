'use strict';

/** CSV export for the filtered B2B target list. */

const COLUMNS = [
  ['name', 'Name'],
  ['domain', 'Domain'],
  ['category', 'Category'],
  ['needs', 'Purchase Needs'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['website', 'Website'],
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['address', 'Address'],
  ['city', 'City'],
  ['country', 'Country'],
];

function esc(v) {
  if (v == null) v = '';
  if (Array.isArray(v)) v = v.join(' | ');
  v = String(v);
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function toCSV(rows) {
  const header = COLUMNS.map(([, label]) => esc(label)).join(',');
  const lines = rows.map((r) => COLUMNS.map(([key]) => esc(r[key])).join(','));
  return '﻿' + [header, ...lines].join('\r\n'); // BOM for Excel/UTF-8
}

module.exports = { toCSV };
