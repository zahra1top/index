/**
 * إعدادات — استبدل القيم أدناه بقيمك
 */
const SPREADSHEET_ID = '14cGzgyxEeLLsmRFwN4CxOdgpd5FtQcFCUjkbG1HU1Jg';
const SHEET_NAME = 'نظام'; // اسم الشيت
// ترتيب الأعمدة في الشيت حسب طلبكم:
// A: وقت تسجيل الدخول (Timestamp)
// B: كلمة السر
// C: الاسم
// D: رقم الهوية
// E: رقم الهاتف
// F: الإيميل
// G: جهة التكليف
// H: السيرة الذاتية (رابط PDF)
// I: الهوية الوطنية (رابط PDF)
// J: شهادة الإيبان (رابط PDF)
// K: العنوان الوطني (رابط PDF)

const DRIVE_FOLDER_ID = '147q7is4g-BPwoC6oVxaNtDlB0hmQi-dX'; // مجلد لحفظ ملفات الـPDF
const CONFIG_SHEET = 'Config'; // شيت ضبط يحتوي خلية UPLOADS_ENABLED

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action.toString() : '';
  
  if (action === 'getProfile') {
    return jsonResponse(getProfile_(e.parameter.loginId, e.parameter.password));
  }
  if (action === 'isUploadsEnabled') {
    const enabled = isUploadsEnabled_();
    return jsonResponse({ enabled });
  }
  
  return jsonResponse({ success: false, message: 'Unsupported GET action' });
}

function doPost(e){
  // يدعم JSON و multipart/form-data
  let payload = {};
  try{
    if(e.postData && e.postData.type === 'application/json'){
      payload = JSON.parse(e.postData.contents||'{}');
    }
  }catch(err){}

  const action = (payload.action || (e.parameter.action||'')).toString();

  if(action === 'login'){
    const loginId = (payload.loginId||'').trim();
    const password = (payload.password||'').trim();
    return jsonResponse( login_(loginId, password) );
  }

  if(action === 'toggleUploads'){
    const pin = (payload.pin||'').trim();
    const out = toggleUploads_(pin);
    return jsonResponse(out);
  }

  if(action === 'saveFiles'){
    // نتوقع multipart/form-data
    const loginId = (e.parameter.loginId||'').trim();
    const password = (e.parameter.password||'').trim();
    const auth = authenticate_(loginId, password);
    if(!auth.success) return jsonResponse(auth);

    if(!isUploadsEnabled_()){
      return jsonResponse({success:false, message:'الرفع مقفول حالياً'});
    }

    const row = auth.row;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME);
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

    const files = e.files || {};
    const result = { success:true };

    // helper
    const save = (fileObj, prefix, col) => {
      if(!fileObj) return null;
      const blob = fileObj; // blob
      const name = prefix + '_' + new Date().toISOString().replace(/[:.]/g,'-') + '.pdf';
      const driveFile = folder.createFile(blob).setName(name);
      const url = driveFile.getUrl();
      sh.getRange(row, col).setValue(url);
      return url;
    };

    // أعمدة H..K = 8..11
    if(files.cv){ result.cvUrl = save(files.cv, 'CV', 8); }
    if(files.nationalID){ result.nationalIdPdfUrl = save(files.nationalID, 'NATIONAL_ID', 9); }
    if(files.iban){ result.ibanPdfUrl = save(files.iban, 'IBAN', 10); }
    if(files.address){ result.addressPdfUrl = save(files.address, 'ADDRESS', 11); }

    return jsonResponse(result);
  }

  return jsonResponse({success:false, message:'Unsupported POST action'});
}

/** ====== منطق العمل ====== */

function jsonResponse(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  return sh;
}

function login_(loginId, password){
  const auth = authenticate_(loginId, password);
  if(!auth.success) return auth;

  // حدّث وقت تسجيل الدخول (العمود A)
  const sh = getSheet_();
  sh.getRange(auth.row, 1).setValue(new Date()); // Timestamp

  const rowValues = sh.getRange(auth.row, 1, 1, 11).getValues()[0];
  return {
    success:true,
    name: rowValues[2] || '',
    nationalId: rowValues[3] || '',
    phone: rowValues[4] || '',
    email: rowValues[5] || '',
    assignment: rowValues[6] || ''
  };
}

function getProfile_(loginId, password){
  const auth = authenticate_(loginId, password);
  if(!auth.success) return auth;

  const sh = getSheet_();
  const rowValues = sh.getRange(auth.row, 1, 1, 11).getValues()[0];
  return {
    success:true,
    name: rowValues[2] || '',
    nationalId: rowValues[3] || '',
    phone: rowValues[4] || '',
    email: rowValues[5] || '',
    assignment: rowValues[6] || '',
    cvUrl: rowValues[7] || '',
    nationalIdPdfUrl: rowValues[8] || '',
    ibanPdfUrl: rowValues[9] || '',
    addressPdfUrl: rowValues[10] || ''
  };
}

function authenticate_(loginId, password){
  if(!loginId || !password){
    return {success:false, message:'الرجاء إدخال بيانات الدخول'};
  }
  const sh = getSheet_();
  const data = sh.getDataRange().getValues(); // includes header if any
  // ابحث بالهوية أو الإيميل
  for(let r=1; r<data.length; r++){ // اترك الصف 0 للرؤوس (إن وجدت)
    const row = data[r];
    const pass = (row[1]||'').toString().trim(); // B
    const name = (row[2]||'').toString().trim(); // C
    const nid  = (row[3]||'').toString().trim(); // D
    const phone= (row[4]||'').toString().trim(); // E
    const email= (row[5]||'').toString().trim(); // F
    if( (email && email === loginId) || (nid && nid === loginId) ){
      if(pass === password){
        return {success:true, row:r+1, name, nationalId:nid, phone, email};
      }else{
        return {success:false, message:'كلمة المرور غير صحيحة'};
      }
    }
  }
  return {success:false, message:'المستخدم غير موجود'};
}

/** قفل/فتح استقبال الملفات عبر PIN
 *  إدخل 123 -> قفل (enabled=false)
 *  إدخل 1234 -> فتح (enabled=true)
 */
function toggleUploads_(pin){
  if(pin !== '123' && pin !== '1234'){
    return {success:false, message:'الرمز غير صحيح'};
  }
  const enabled = (pin === '1234');
  setUploadsEnabled_(enabled);
  return {success:true, enabled};
}

function isUploadsEnabled_(){
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CONFIG_SHEET);
  if(!sh) return true; // إن لم توجد شيت Config اعتبر أنها مفتوحة
  const v = sh.getRange('A1').getValue(); // ضع في A1 كلمة UPLOADS_ENABLED / TRUE-FALSE
  // نقبل أي قيمة truthy
  return !!v;
}

function setUploadsEnabled_(enabled){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG_SHEET);
  if(!sh){ sh = ss.insertSheet(CONFIG_SHEET); }
  sh.getRange('A1').setValue(enabled);
}
