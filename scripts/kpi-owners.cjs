const API = 'https://script.google.com/macros/s/AKfycbxI66Y3lZZqeSlZCdIQKVrPGla10AvM-3vVI89t8gc49ld4ukH3wnrIIEiuCv6khAAA/exec';
(async () => {
  const res = await fetch(API, { redirect: 'follow' });
  const data = await res.json();
  const owners = [];
  let currentOwner = null;
  let kpiCount = 0;
  data.forEach((row, i) => {
    if (row.L && row.L !== 'Owner' && row.L !== '') {
      if (currentOwner) owners.push({ name: currentOwner.name, startRow: currentOwner.startRow, kpiCount });
      currentOwner = { name: row.L, startRow: i };
      kpiCount = 1;
    } else if (row.L === '' && row[''] && row[''] !== '' && currentOwner) {
      kpiCount++;
    }
  });
  if (currentOwner) owners.push({ name: currentOwner.name, startRow: currentOwner.startRow, kpiCount });
  console.log('=== ALL OWNERS ===');
  owners.forEach(o => console.log(o.name + ': ' + o.kpiCount + ' KPIs (starts at row ' + o.startRow + ')'));
  console.log('\nTotal owners:', owners.length);
  console.log('Total rows:', data.length);
  
  // Get all unique KPI names per owner
  owners.forEach(o => {
    const kpis = [];
    for (let i = o.startRow; i < data.length; i++) {
      const r = data[i];
      if (i > o.startRow && r.L && r.L !== '' && r.L !== 'Owner') break;
      if (r[''] && r[''] !== 'KPI' && r[''] !== '') kpis.push(r['']);
    }
    console.log('\n' + o.name + ' KPIs:');
    kpis.forEach((k, j) => console.log('  ' + (j+1) + '. ' + k));
  });
})();
