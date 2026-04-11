function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  if (action === 'setup') {
    setup_();
    return ContentService.createTextOutput(JSON.stringify({ ok: true, dbId: getDbId_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('建築2次 過去問学習')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setup_() {
  var id = getDbId_();
  if (!id) {
    var ss = SpreadsheetApp.create('Archi2ji_DB_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd'));
    setDbId_(ss.getId());
    Logger.log('Database created: ' + ss.getName() + ' ' + ss.getUrl());
  }
  Object.keys(SHEETS).forEach(function(k) { getSheet_(SHEETS[k]); });
  Logger.log('Setup complete');
}
