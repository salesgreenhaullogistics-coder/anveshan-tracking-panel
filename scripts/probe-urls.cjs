/**
 * probe-urls.cjs
 *
 * Fetches sample POD filenames from the Anveshan API, then tests
 * every candidate base-URL pattern concurrently to find which one
 * actually serves the POD image files (HTTP 200 + image content-type).
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec';

async function main() {
  // ──────────────────────────────────────────────
  // 1. Fetch sample rows from the API
  // ──────────────────────────────────────────────
  console.log('Fetching sample data from API...\n');
  const res = await fetch(API_URL);
  if (!res.ok) {
    console.error(`API request failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const data = await res.json();
  const rows = Array.isArray(data) ? data : data.data || data.rows || [];
  console.log(`Total rows returned: ${rows.length}\n`);

  // Collect rows that have a non-empty POD field
  const podRows = rows
    .filter((r) => r.POD && typeof r.POD === 'string' && r.POD.trim() !== '')
    .slice(0, 5);

  if (podRows.length === 0) {
    console.error('No rows with a POD field found. Dumping first 3 rows for inspection:');
    rows.slice(0, 3).forEach((r, i) => console.log(`Row ${i}:`, JSON.stringify(r, null, 2)));
    process.exit(1);
  }

  console.log('Sample POD values:');
  podRows.forEach((r, i) => {
    console.log(`  [${i}] POD = ${r.POD}`);
  });
  console.log();

  // ──────────────────────────────────────────────
  // 2. Extract filename & objectId from first POD
  // ──────────────────────────────────────────────
  const podValue = podRows[0].POD.trim();

  // The POD field might be a full URL or just a filename.
  // If it's a URL, extract the filename portion.
  let filename;
  try {
    const u = new URL(podValue);
    filename = u.pathname.split('/').pop();
    console.log(`POD value is a URL: ${podValue}`);
    console.log(`Extracted filename: ${filename}`);
    console.log(`\n*** The POD field already contains the full URL! ***`);
    console.log(`Base URL: ${u.origin}${u.pathname.replace(filename, '')}\n`);

    // Still verify it actually works
    console.log('Verifying the URL from the POD field...');
    const verify = await fetch(podValue, { method: 'HEAD', redirect: 'follow' });
    console.log(`  Status: ${verify.status}`);
    console.log(`  Content-Type: ${verify.headers.get('content-type')}`);
    console.log();

    // If it works, we might be done, but let's still probe the patterns
    // in case we need a different base URL
  } catch {
    // Not a URL, treat as filename
    filename = podValue;
    console.log(`POD value (filename): ${filename}`);
  }

  // Extract MongoDB ObjectId (24-char hex) from filename
  const objectIdMatch = filename.match(/([a-f0-9]{24})/i);
  const objectId = objectIdMatch ? objectIdMatch[1] : null;
  console.log(`Extracted ObjectId: ${objectId || '(none found)'}\n`);

  // ──────────────────────────────────────────────
  // 3. Build all candidate URLs
  // ──────────────────────────────────────────────
  const urls = [];
  const addUrl = (label, url) => urls.push({ label, url });

  // Shiprocket S3 patterns
  addUrl('SR S3 path-style /kr-shiprocket/', `https://s3.ap-south-1.amazonaws.com/kr-shiprocket/${filename}`);
  addUrl('SR S3 vhost kr-shiprocket', `https://kr-shiprocket.s3.ap-south-1.amazonaws.com/${filename}`);
  addUrl('SR S3 path /kr-shiprocket/pods/', `https://s3.ap-south-1.amazonaws.com/kr-shiprocket/pods/${filename}`);
  addUrl('SR S3 vhost kr-shiprocket/pods/', `https://kr-shiprocket.s3.ap-south-1.amazonaws.com/pods/${filename}`);
  addUrl('SR S3 /sr-uploads/', `https://s3.ap-south-1.amazonaws.com/sr-uploads/${filename}`);
  addUrl('SR S3 vhost sr-uploads', `https://sr-uploads.s3.ap-south-1.amazonaws.com/${filename}`);
  addUrl('SR S3 /sr-pod/', `https://s3.ap-south-1.amazonaws.com/sr-pod/${filename}`);
  addUrl('SR S3 /shiprocket-pods/', `https://s3.ap-south-1.amazonaws.com/shiprocket-pods/${filename}`);
  addUrl('SR S3 /shiprocket/', `https://s3.ap-south-1.amazonaws.com/shiprocket/${filename}`);
  addUrl('SR S3 /kr-shiprocket-uploads/', `https://s3.ap-south-1.amazonaws.com/kr-shiprocket-uploads/${filename}`);
  addUrl('SR S3 /shiprocket-delivery/', `https://s3.ap-south-1.amazonaws.com/shiprocket-delivery/${filename}`);

  // Shiprocket CDN patterns
  addUrl('SR CDN sr-cdn/', `https://sr-cdn.shiprocket.in/${filename}`);
  addUrl('SR CDN sr-cdn/pods/', `https://sr-cdn.shiprocket.in/pods/${filename}`);
  addUrl('SR CDN cdn/', `https://cdn.shiprocket.in/${filename}`);
  addUrl('SR CDN cdn/pods/', `https://cdn.shiprocket.in/pods/${filename}`);
  addUrl('SR CDN assets/', `https://assets.shiprocket.in/${filename}`);
  addUrl('SR CDN assets/pods/', `https://assets.shiprocket.in/pods/${filename}`);

  // Shiprocket API patterns (require objectId)
  if (objectId) {
    addUrl('SR API /courier/pod/{id}', `https://apiv2.shiprocket.in/v1/external/courier/pod/${objectId}`);
    addUrl('SR API /v1/pod/{id}', `https://apiv2.shiprocket.in/v1/pod/${objectId}`);
    addUrl('SR app /api/pods/{id}/download', `https://app.shiprocket.in/api/pods/${objectId}/download`);
    addUrl('SR app /api/pods/{id}/image', `https://app.shiprocket.in/api/pods/${objectId}/image`);
  }
  addUrl('SR app /pod-image/', `https://app.shiprocket.in/pod-image/${filename}`);
  addUrl('SR app /pods/', `https://app.shiprocket.in/pods/${filename}`);

  // Anveshan S3/CDN patterns
  addUrl('Anv S3 /anveshan/', `https://s3.ap-south-1.amazonaws.com/anveshan/${filename}`);
  addUrl('Anv S3 /anveshan-pods/', `https://s3.ap-south-1.amazonaws.com/anveshan-pods/${filename}`);
  addUrl('Anv S3 vhost anveshan', `https://anveshan.s3.ap-south-1.amazonaws.com/${filename}`);
  addUrl('Anv S3 vhost anveshan-pods', `https://anveshan-pods.s3.ap-south-1.amazonaws.com/${filename}`);
  addUrl('Anv ops /media/', `https://ops.anveshan.farm/media/${filename}`);
  addUrl('Anv ops /media/pods/', `https://ops.anveshan.farm/media/pods/${filename}`);
  addUrl('Anv ops /static/', `https://ops.anveshan.farm/static/${filename}`);

  // Generic S3 patterns
  addUrl('Generic S3 us /kr-shiprocket/', `https://s3.amazonaws.com/kr-shiprocket/${filename}`);
  addUrl('Generic S3 /weight-fix/', `https://s3.ap-south-1.amazonaws.com/weight-fix/${filename}`);

  console.log(`Testing ${urls.length} URL patterns concurrently...\n`);
  console.log('='.repeat(120));

  // ──────────────────────────────────────────────
  // 4. Probe all URLs concurrently
  // ──────────────────────────────────────────────
  const results = await Promise.allSettled(
    urls.map(async ({ label, url }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const ct = r.headers.get('content-type') || '(none)';
        return { label, url, status: r.status, contentType: ct };
      } catch (err) {
        clearTimeout(timeout);
        return { label, url, status: 'ERR', contentType: err.message };
      }
    })
  );

  // ──────────────────────────────────────────────
  // 5. Display results
  // ──────────────────────────────────────────────
  const hits = [];
  const misses = [];

  for (const r of results) {
    const val = r.status === 'fulfilled' ? r.value : { label: '??', url: '??', status: 'REJECTED', contentType: r.reason?.message || '' };
    const isHit =
      val.status === 200 &&
      typeof val.contentType === 'string' &&
      val.contentType.startsWith('image/');

    if (isHit) hits.push(val);
    else misses.push(val);
  }

  // Print hits first
  if (hits.length > 0) {
    console.log('\n*** HITS (200 + image content-type) ***\n');
    for (const h of hits) {
      console.log(`  [HIT] ${h.label}`);
      console.log(`        URL:          ${h.url}`);
      console.log(`        Status:       ${h.status}`);
      console.log(`        Content-Type: ${h.contentType}`);
      console.log();
    }
  } else {
    console.log('\n*** NO HITS FOUND ***\n');
  }

  // Print all results in a table
  console.log('\nFull results:\n');
  console.log(
    'Status'.padEnd(8) +
    'Content-Type'.padEnd(40) +
    'Label'
  );
  console.log('-'.repeat(120));

  for (const r of results) {
    const val = r.status === 'fulfilled' ? r.value : { label: '??', status: 'REJECTED', contentType: '' };
    const statusStr = String(val.status).padEnd(8);
    const ctStr = String(val.contentType).substring(0, 38).padEnd(40);
    console.log(`${statusStr}${ctStr}${val.label}`);
  }

  // ──────────────────────────────────────────────
  // 6. If we got hits, verify with additional samples
  // ──────────────────────────────────────────────
  if (hits.length > 0 && podRows.length > 1) {
    console.log('\n' + '='.repeat(120));
    console.log('\nVerifying top hit(s) against additional POD samples...\n');

    for (const hit of hits) {
      // Derive the base URL pattern
      const baseUrl = hit.url.replace(filename, '');
      console.log(`Base URL pattern: ${baseUrl}{filename}\n`);

      for (let i = 1; i < podRows.length; i++) {
        let sampleFilename = podRows[i].POD.trim();
        try {
          const u = new URL(sampleFilename);
          sampleFilename = u.pathname.split('/').pop();
        } catch { /* not a URL */ }

        const testUrl = baseUrl + sampleFilename;
        try {
          const r = await fetch(testUrl, { method: 'HEAD', redirect: 'follow' });
          const ct = r.headers.get('content-type') || '(none)';
          const ok = r.status === 200 && ct.startsWith('image/') ? 'OK' : 'FAIL';
          console.log(`  [${ok}] Sample ${i}: status=${r.status} ct=${ct}`);
          console.log(`         ${testUrl}`);
        } catch (err) {
          console.log(`  [ERR] Sample ${i}: ${err.message}`);
          console.log(`         ${testUrl}`);
        }
      }
      console.log();
    }
  }

  // Also check if POD field itself contains URLs that work
  if (podRows.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log('\nChecking if POD field values are direct URLs...\n');
    for (let i = 0; i < podRows.length; i++) {
      const pod = podRows[i].POD.trim();
      try {
        new URL(pod); // throws if not a URL
        const r = await fetch(pod, { method: 'HEAD', redirect: 'follow' });
        const ct = r.headers.get('content-type') || '(none)';
        const ok = r.status === 200 && ct.startsWith('image/') ? 'OK' : 'FAIL';
        console.log(`  [${ok}] POD[${i}]: status=${r.status} ct=${ct}`);
        console.log(`         ${pod}`);
      } catch {
        console.log(`  [---] POD[${i}]: Not a URL -> ${pod.substring(0, 80)}`);
      }
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
