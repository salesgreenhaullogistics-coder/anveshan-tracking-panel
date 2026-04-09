const API = 'https://script.google.com/macros/s/AKfycbxI66Y3lZZqeSlZCdIQKVrPGla10AvM-3vVI89t8gc49ld4ukH3wnrIIEiuCv6khAAA/exec';
(async () => {
  const res = await fetch(API, { redirect: 'follow' });
  const data = await res.json();
  console.log('Total rows:', data.length);
  console.log('\n=== ALL ROWS (Owner + KPI) ===');
  data.forEach((row, i) => {
    console.log('\nRow ' + i + ': Owner="' + row.L + '", KPI="' + row[''] + '"');
    const dateKeys = Object.keys(row).filter(k => k !== 'L' && k !== '');
    const nonEmpty = dateKeys.filter(k => row[k] !== '' && row[k] !== undefined);
    console.log('  Total dates: ' + dateKeys.length + ', Non-empty: ' + nonEmpty.length);
    console.log('  Sample values:', nonEmpty.slice(0, 8).map(k => k.slice(0,10) + '=' + row[k]).join(', '));
    const nums = nonEmpty.map(k => row[k]).filter(v => typeof v === 'number');
    if (nums.length > 0) {
      console.log('  Numeric range: ' + Math.min(...nums) + ' to ' + Math.max(...nums) + ', avg=' + (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(4));
    }
    const strings = nonEmpty.map(k => row[k]).filter(v => typeof v === 'string');
    const uniqueStrings = [...new Set(strings)];
    if (uniqueStrings.length > 0) {
      console.log('  String values: ' + uniqueStrings.join(', '));
    }
  });
  const allKeys = Object.keys(data[0]).filter(k => k !== 'L' && k !== '');
  console.log('\n=== DATE COLUMNS ===');
  console.log('First 5:', allKeys.slice(0, 5));
  console.log('Last 5:', allKeys.slice(-5));
  console.log('Total date columns:', allKeys.length);
})();
