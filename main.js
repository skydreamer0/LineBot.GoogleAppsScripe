// 配置變量
var LINE_CHANNEL_ACCESS_TOKEN = 'WsKmf3hSfl7okZjU7Otw7ad5aBpgkp/f2zvQADBf4/+U8wlQOXRDG7Q014mROVTI19aHbs0iK0zZSlvz75k66slbs5GOBlBWYL6wt9+7aVPEZOl8I0HdYdqufq9l+kqrGLibJ4OhzGUvDtdjL5dPxwdB04t89/1O/w1cDnyilFU=';
var LINE_CHANNEL_SECRET = '2aaf6b6afc0bac75f5764eac45232f02';
var SHEET_ID = '16o9S-__fG6RI0cIWfWl3jxQ5X7N5ZkoC8YkWA7-rl9Q';
var GEMINI_API_KEY = 'AIzaSyCW92hrcXyfnbBxD4euPYhPVp5-V7otlj0';

// 添加 LIFF 配置
var LIFF_ID = 'your_liff_id'; // 請替換為您的 LIFF ID

// 添加 LINE Login 相關配置
var LINE_LOGIN_CHANNEL_ID = 'your_login_channel_id';
var LINE_LOGIN_CHANNEL_SECRET = 'your_login_channel_secret';

// 全局變量
var userStates = {};
var aiChatStates = {};

// LineBotHandler 類
function LineBotHandler() {}

// 添加輸入驗證函數
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, ''); // 移除潛在的 HTML 標籤
}

// 添加結構化日誌功能
function logEvent(type, userId, action, details) {
  var logSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Logs');
  var timestamp = new Date();
  logSheet.appendRow([
    timestamp,
    type,
    userId,
    action,
    JSON.stringify(details)
  ]);
  Logger.log(`${type} - User: ${userId}, Action: ${action}`);
}

// 處理訊息事件
LineBotHandler.prototype.handleMessage = function(event) {
  var userId = event.source.userId;
  var messageContent = sanitizeInput(event.message.text);
  
  Logger.log("收到來自用戶 " + userId + " 的訊息: " + messageContent);
  
  // 保存用戶訊息到數據庫
  saveMessageToDb(userId, messageContent);
  
  var response;
  
  if (messageContent === "@主選單") {
    response = { type: "text", text: "請選擇您要使用的功能：", quickReply: createMainMenu() };
  } else if (messageContent === "@會員功能") {
    response = { type: "text", text: "請選擇會員相關功能：", quickReply: createMemberMenu() };
  } else if (aiChatStates[userId]) {
    if (messageContent.toLowerCase() === '@結束ai') {
      aiChatStates[userId] = false;
      response = { type: "text", text: "AI 對話已結束。", quickReply: createMainMenu() };
    } else {
      var aiResponse = callGeminiApi(messageContent);
      response = { type: "text", text: aiResponse };
    }
  } else if (messageContent.toLowerCase() === '@召喚ai') {
    aiChatStates[userId] = true;
    response = { type: "text", text: "AI 已就緒，請開始您的對話。輸入「@結束AI」可以結束 AI 對話模式。" };
  } else if (['@加入會員', '@修改資料', '@我的資料'].indexOf(messageContent) !== -1 || userId in userStates) {
    handleMembership(event, messageContent);
    return;
  } else if (messageContent === "@幫") {
    var helpText = "您可以使用以下指令：\n" +
                   "@主選單 - 顯示主選單\n" +
                   "@會員功能 - 顯示會員相關功能\n" +
                   "@召喚AI - 開始 AI 對話\n" +
                   "@結束AI - 結束 AI 對話\n" +
                   "@幫助 - 顯示此幫助信息";
    response = { type: "text", text: helpText, quickReply: createMainMenu() };
  } else {
    response = { type: "text", text: "抱歉，我不理解您的指令。以下是可用的功能：", quickReply: createMainMenu() };
  }

  // 保存系統回覆到數據庫
  if (response.type === "text") {
    saveMessageToDb(userId, response.text, true);
  }

  sendReplyMessage(event.replyToken, response);
  Logger.log("已發送回覆給用戶 " + userId);
};

// 處理會員功能邏輯
function handleMembership(event, userMessage) {
  var userId = event.source.userId;
  var user = getUserFromSheet(userId);
  var userName = user ? user.name : userId;
  var userState = userStates[userId] || {};
  var currentState = userState.state || 'start';

  Logger.log("處理用戶 " + userName + " 的會員功能，當前狀態: " + currentState + ", 訊息: " + userMessage);

  var response;

  if (userMessage === '@加入會員' || userMessage === '@修改資料') {
    response = {
        type: "template",
        altText: "請點擊按鈕進行身分驗證",
        template: {
            type: "buttons",
            text: "為了提供更好的服務，請先進行身分驗證",
            actions: [
                {
                    type: "uri",
                    label: "點擊進行驗證",
                    uri: `https://liff.line.me/${LIFF_ID}`
                }
            ]
        }
    };
  } else if (currentState === 'confirm_nickname') {
    if (userMessage === '是') {
      userStates[userId].state = 'input_birthday';
      userStates[userId].tempData.name = userStates[userId].tempData.nickname;
      response = createUserInfoTemplate("請選擇您的生日：");
    } else if (userMessage === '否') {
      userStates[userId].state = 'input_name';
      response = { type: "text", text: "請輸入您的真實姓名：" };
    } else {
      response = { type: "text", text: "請回答「是」或「否」。" };
    }
  } else if (currentState === 'input_name') {
    if (isValidName(userMessage)) {
      userStates[userId].state = 'input_birthday';
      userStates[userId].tempData.name = userMessage;
      response = createUserInfoTemplate("請選擇您的生日：");
    } else {
      response = { type: "text", text: "姓名格式不正確，請輸入至少兩個漢字的中文姓名。" };
    }
  } else if (currentState === 'input_birthday') {
    var birthday = convertBirthday(userMessage);
    if (birthday) {
      userStates[userId].state = 'input_phone';
      userStates[userId].tempData.birthday = birthday;
      response = { type: "text", text: "請輸入您的電話號碼：" };
    } else {
      response = { type: "text", text: "生日格式不正確，請使用YYYY-MM-DD格式或使用日期選擇器。" };
    }
  } else if (currentState === 'input_phone') {
    if (isValidPhone(userMessage)) {
      userStates[userId].state = 'confirm_info';
      userStates[userId].tempData.phone = userMessage;
      var tempData = userStates[userId].tempData;
      
      // 添加確認訊息的格式化
      var confirmMessage = "請確認您的資料：\n" +
                          "姓名：" + tempData.name + "\n" +
                          "生日：" + tempData.birthday + "\n" +
                          "電話：" + tempData.phone;
      
      response = createConfirmTemplate(confirmMessage, 'confirm_info');
    } else {
      response = { 
        type: "text", 
        text: "電話號碼格式不正確，請輸入有效的台灣手機或市話號碼。\n" +
              "手機格式：09XXXXXXXX\n" +
              "市話格式：0X-XXXXXXXX" 
      };
    }
  } else if (userMessage === '@我的資料') {
    var user = getUserFromSheet(userId);
    if (user) {
      // 改善資料顯示格式
      var userDataMessage = "您的會員資料：\n" +
                           "─────────────\n" +
                           "📋 姓名：" + user.name + "\n" +
                           "🎂 生日：" + (user.birthday || '未設置') + "\n" +
                           "📱 電話：" + (user.phone || '未設置') + "\n" +
                           "─────────────\n" +
                           "若要修改資料請輸入「@修改資料」";
      
      response = { type: "text", text: userDataMessage };
    } else {
      response = { 
        type: "text", 
        text: "您尚未註冊會員\n請點選下方選單進行註冊",
        quickReply: createMemberMenu()
      };
    }
  } else {
    // 添加會話超時檢查
    if (userState.lastActivity && (new Date() - new Date(userState.lastActivity)) > 300000) { // 5分鐘超時
      delete userStates[userId];
      response = { 
        type: "text", 
        text: "由於閒置時間過長，請重新開始操作。",
        quickReply: createMainMenu()
      };
    } else {
      response = { 
        type: "text", 
        text: "抱歉，我不理解您的指令。請使用選單進行操作。",
        quickReply: createMainMenu()
      };
    }
  }

  // 更新最後活動時間
  if (userStates[userId]) {
    userStates[userId].lastActivity = new Date();
  }

  if (response) {
    if (response.type === "text") {
      Logger.log("回覆用戶 " + userName + ": " + response.text);
      saveMessageToDb(userId, response.text, true);
    } else {
      Logger.log("回覆用戶 " + userName + ": " + JSON.stringify(response));
      saveMessageToDb(userId, JSON.stringify(response), true);
    }
    sendReplyMessage(event.replyToken, response);
  } else {
    Logger.log("沒有為用戶 " + userName + " 生成回覆");
  }
}

// 新增解析函數
function parsePostbackData(postbackData) {
  var data = {};
  var pairs = postbackData.split('&');
  for (var i = 0; i < pairs.length; i++) {
    var parts = pairs[i].split('=');
    data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
  }
  return data;
}

// 修改後的 handlePostback 函數
function handlePostback(event) {
  var userId = event.source.userId;
  logEvent('POSTBACK', userId, 'handlePostback', event.postback);
  var user = getUserFromSheet(userId);
  var userName = user ? user.name : userId;
  var postbackData = event.postback.data;
  
  Logger.log("處理用戶 " + userName + " 的 Postback 事件: " + postbackData);

  var response;

  var data = parsePostbackData(postbackData);
  var action = data.action;
  var choice = data.choice;

  if (action === 'birthday_picked') {
    if (event.postback.params && event.postback.params.date) {
      var birthdayStr = event.postback.params.date;
      var birthday = new Date(birthdayStr);
      userStates[userId].tempData.birthday = birthday;
      userStates[userId].state = 'input_phone';
      response = { type: "text", text: "您選擇的生日是 " + birthdayStr + "。\n請輸入您的電話號碼。" };
    } else {
      response = { type: "text", text: "無法獲取生日資訊，請重新選擇。" };
    }
  } else if (action === 'confirm_name') {
    if (choice === 'yes') {
      userStates[userId].state = 'input_birthday';
      userStates[userId].tempData.name = userStates[userId].tempData.nickname;
      response = {
        type: "template",
        altText: "請選擇生日",
        template: {
          type: "buttons",
          text: "請選擇您的生日：",
          actions: [
            {
              type: "datetimepicker",
              label: "選擇日期",
              data: "action=birthday_picked",
              mode: "date"
            }
          ]
        }
      };
    } else {
      userStates[userId].state = 'input_name';
      response = { 
        type: "text", 
        text: "請輸入您的真實姓名：" 
      };
    }
    sendReplyMessage(event.replyToken, response);
  } else if (action === 'confirm_info') {
    if (choice === 'yes') {
      var tempData = userStates[userId].tempData;
      saveUserToSheet(userId, tempData);
      delete userStates[userId];
      response = { type: "text", text: "感謝您的確認！您的資料已成功保存。" };
    } else {
      userStates[userId] = { state: 'confirm_nickname', tempData: userStates[userId].tempData };
      var nickname = userStates[userId].tempData.nickname;
      response = createConfirmTemplate("您的暱稱是「" + nickname + "」，這是否為您的真實姓名？", 'confirm_nickname');
    }
  } else {
    response = { type: "text", text: "未知的操作，請重試。" };
  }

  if (response) {
    if (response.type === "text") {
      Logger.log("回覆用戶 " + userName + ": " + response.text);
      saveMessageToDb(userId, response.text, true);
    } else {
      Logger.log("回覆用戶 " + userName + ": " + JSON.stringify(response));
      saveMessageToDb(userId, JSON.stringify(response), true);
    }
    sendReplyMessage(event.replyToken, response);
  } else {
    Logger.log("沒有為用戶 " + userName + " 生成回覆");
  }
}

// 輔助函數
function saveMessageToDb(userId, content, isFromAdmin) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Messages');
  sheet.appendRow([new Date(), userId, content, isFromAdmin ? 'Admin' : 'User']);
}

// 添加緩存機制
var CACHE_DURATION = 21600; // 6小時的秒數

function getUserFromSheet(userId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'user_' + userId;
  var cachedData = cache.get(cacheKey);
  
  if (cachedData != null) {
    return JSON.parse(cachedData);
  }
  
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Users');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      var userData = {
        id: data[i][0],
        name: data[i][1],
        birthday: data[i][2],
        phone: data[i][3]
      };
      cache.put(cacheKey, JSON.stringify(userData), CACHE_DURATION);
      return userData;
    }
  }
  return null;
}

function saveUserToSheet(userId, userData) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Users');
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) {
    sheet.appendRow([userId, userData.name, userData.birthday, userData.phone]);
  } else {
    sheet.getRange(rowIndex, 2, 1, 3).setValues([[userData.name, userData.birthday, userData.phone]]);
  }
}

function createMainMenu() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "會員功能", text: "@會員功能" } },
      { type: "action", action: { type: "message", label: "AI 對話", text: "@召喚AI" } },
      { type: "action", action: { type: "message", label: "幫助", text: "@幫助" } }
    ]
  };
}

function createMemberMenu() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "加入會員", text: "@加入會員" } },
      { type: "action", action: { type: "message", label: "修改資料", text: "@修改資料" } },
      { type: "action", action: { type: "message", label: "查看資料", text: "@我的資料" } },
      { type: "action", action: { type: "message", label: "返回主選單", text: "@主選單" } }
    ]
  };
}

function createConfirmTemplate(text, action) {
  return {
    type: "template",
    altText: text,
    template: {
      type: "confirm",
      text: text,
      actions: [
        { type: "postback", label: "是", data: "action=" + action + "&choice=yes" },
        { type: "postback", label: "否", data: "action=" + action + "&choice=no" }
      ]
    }
  };
}

function createUserInfoTemplate(text) {
  return {
    type: "template",
    altText: text,
    template: {
      type: "buttons",
      text: text,
      actions: [
        {
          type: "datetimepicker",
          label: "選擇生日",
          data: "action=birthday_picked",
          mode: "date"
        }
      ]
    }
  };
}

function getUserProfile(userId) {
  var url = "https://api.line.me/v2/bot/profile/" + userId;
  var options = {
    headers: { Authorization: "Bearer " + LINE_CHANNEL_ACCESS_TOKEN },
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() == 200) {
    return JSON.parse(response.getContentText());
  }
  return null;
}

function callGeminiApi(userInput) {
  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + GEMINI_API_KEY;
    var payload = {
      contents: [{ parts: [{ text: userInput }] }]
    };
    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      Logger.log('API 請求失敗: ' + responseCode);
      return "抱歉，AI 服務暫時無法使用，請稍後再試。";
    }
    
    var result = JSON.parse(response.getContentText());
    return result.candidates[0].content.parts[0].text;
  } catch (error) {
    Logger.log('AI API 錯誤: ' + error);
    return "系統發生錯誤，請稍後再試。";
  }
}

function sendReplyMessage(replyToken, message) {
  var url = "https://api.line.me/v2/bot/message/reply";
  var payload = {
    replyToken: replyToken,
    messages: [message]
  };
  var options = {
    method: "post",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN 
    },
    payload: JSON.stringify(payload)
  };
  UrlFetchApp.fetch(url, options);
}

function isValidName(name) {
  return /^[\u4e00-\u9fa5]{2,}$/.test(name.trim());
}

function isValidPhone(phone) {
  return /^(09\d{8}|0\d{1,2}-?\d{6,8})$/.test(phone.replace(/\s/g, ''));
}

function convertBirthday(birthdayStr) {
  var date = new Date(birthdayStr);
  return isNaN(date.getTime()) ? null : Utilities.formatDate(date, "GMT+8", "yyyy-MM-dd");
}

// 處理 POST 請求
function doPost(e) {
  var json = JSON.parse(e.postData.contents);
  var event = json.events[0];

  Logger.log("接收到的事件: " + JSON.stringify(event));

  var lineBotHandler = new LineBotHandler();
  
  if (event.type === 'message' && event.message.type === 'text') {
    lineBotHandler.handleMessage(event);
  } else if (event.type === 'postback') {
    handlePostback(event);
  }
  
  return ContentService.createTextOutput(JSON.stringify({'content': 'post ok'})).setMimeType(ContentService.MimeType.JSON);
}

// 處理 GET 請求
function doGet(e) {
  if (e.parameter.code) {
    // 處理授權回調
    var code = e.parameter.code;
    var state = e.parameter.state;
    
    try {
        // 使用授權碼獲取用戶資料
        var accessToken = getLineAccessToken(code);
        var userProfile = getLineUserProfile(accessToken);
        
        // 找到對應的用戶
        var userId = findUserByAuthState(state);
        if (userId) {
            // 更新用戶狀態，進入確認流程
            userStates[userId] = {
                state: 'confirm_nickname',
                tempData: {
                    nickname: userProfile.displayName,
                    email: userProfile.email
                }
            };

            // 發送確認訊息
            var message = {
                type: "template",
                altText: "請確認您的姓名",
                template: {
                    type: "buttons",
                    text: "您的名字是「" + userProfile.displayName + "」，這是否正確？",
                    actions: [
                        {
                            type: "postback",
                            label: "是",
                            data: "action=confirm_name&choice=yes"
                        },
                        {
                            type: "postback",
                            label: "否",
                            data: "action=confirm_name&choice=no"
                        }
                    ]
                }
            };
            
            // 使用 push message API 發送確認訊息
            pushMessage(userId, message);
        }
        
        // 返回成功頁面
        return HtmlService.createHtmlOutput(`
            <h2>驗證成功！</h2>
            <p>請返回 LINE 對話窗口繼續操作。</p>
            <script>
                setTimeout(function() {
                    window.close();
                }, 3000);
            </script>
        `);
        
    } catch (error) {
        Logger.log('授權處理錯誤: ' + error);
        return HtmlService.createHtmlOutput("處理驗證時發生錯誤，請重試");
    }
  }
  
  return HtmlService.createHtmlOutput("<h1>LINE Bot is running!</h1>");
}

// 添加發送 Push Message 的函數
function pushMessage(userId, message) {
    var url = "https://api.line.me/v2/bot/message/push";
    var payload = {
        to: userId,
        messages: [message]
    };
    var options = {
        method: "post",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN 
        },
        payload: JSON.stringify(payload)
    };
    UrlFetchApp.fetch(url, options);
}

// 設置定時任務
function setupTriggers() {
  ScriptApp.newTrigger('dailyTask')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}

// 每日任務
function dailyTask() {
  Logger.log('執行每日任務');
  // 在這裡添加您的每日任務邏輼
}

