const https = require('https');
function fetch(url, max) {
  max = max || 5;
  return new Promise(function(resolve, reject) {
    if(max<=0) return reject('too many redirects');
    https.get(url, function(r) {
      if(r.statusCode>=300 && r.statusCode<400 && r.headers.location) return fetch(r.headers.location, max-1).then(resolve,reject);
      var b=''; r.on('data',function(c){b+=c}); r.on('end',function(){resolve(b)}); r.on('error',reject);
    }).on('error',reject);
  });
}
fetch('https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec').then(function(body) {
  var data = JSON.parse(body);
  // Failure Remarks
  var remarks = {};
  data.forEach(function(r) {
    var m = (r['Failure Remarks'] || '').toString().trim();
    if(m && m !== 'NA' && m !== 'Failure Remarks') remarks[m] = (remarks[m]||0)+1;
  });
  var sorted = Object.entries(remarks).sort(function(a,b){return b[1]-a[1]}).slice(0,30);
  console.log('FAILURE_REMARKS: ' + JSON.stringify(sorted));
  // Year distribution
  var years = {};
  data.forEach(function(r) {
    var bd = r['Booking Date'];
    if(bd) { var d = new Date(bd); if(!isNaN(d)) years[d.getFullYear()] = (years[d.getFullYear()]||0)+1; }
  });
  console.log('YEARS: ' + JSON.stringify(years));
  // Month+Year combos
  var monthYear = {};
  data.forEach(function(r) {
    var bd = r['Booking Date'];
    var m = (r['Month']||'').toString().trim();
    if(bd && m && m !== 'Booking Date' && m !== 'Pickup Date') {
      var d = new Date(bd);
      if(!isNaN(d)) {
        var yr = d.getFullYear().toString().slice(-2);
        var key = m.slice(0,3) + "'" + yr;
        monthYear[key] = (monthYear[key]||0)+1;
      }
    }
  });
  console.log('MONTH_YEAR: ' + JSON.stringify(Object.entries(monthYear).sort()));
  // Platform values
  var platforms = {};
  data.forEach(function(r) {
    var p = (r['Consignee'] || '').toString().trim();
    if(!p || p === 'Consignee') platforms['__EMPTY__'] = (platforms['__EMPTY__']||0)+1;
  });
  console.log('EMPTY_PLATFORM: ' + JSON.stringify(platforms));
}).catch(function(e){ console.error(e); });
