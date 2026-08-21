(function(){
  'use strict';
  var React=window.React;
  var ReactDOM=window.ReactDOM;
  var UI=window.AuralisUI;
  var h=UI.h,MODES=UI.MODES,NAV_ITEMS=UI.NAV_ITEMS;
  var Chip=UI.Chip,Button=UI.Button,ToggleButton=UI.ToggleButton,Surface=UI.Surface,Field=UI.Field,Empty=UI.Empty,SectionHead=UI.SectionHead,Metric=UI.Metric,PipelineStage=UI.PipelineStage,ErrorBoundary=UI.ErrorBoundary;
  var text=UI.text,formatTime=UI.formatTime,formatDate=UI.formatDate,formatDuration=UI.formatDuration,formatBytes=UI.formatBytes,shortId=UI.shortId,roleLabel=UI.roleLabel,modeMeta=UI.modeMeta,eventLabel=UI.eventLabel,toneForState=UI.toneForState,lsGet=UI.lsGet,lsSet=UI.lsSet;

  function isCaptureActive(value){return /STARTING|CAPTURING|RUNNING|VALIDATION_ACTIVE/i.test(String(value||''));}
  function sourceRoleFromChannel(value){return String(value||'').indexOf('system')>=0?'system':'user';}
  function isEditableTarget(target){
    if(!target)return false;
    var tag=String(target.tagName||'').toLowerCase();
    return tag==='input'||tag==='textarea'||tag==='select'||Boolean(target.isContentEditable);
  }
  function isAnswerableTurn(turn){return Boolean(turn&&['question','request'].indexOf(turn.kind)>=0);}
  function shouldAutoAnswerUi(turn,mode,enabled,loopbackEnabled){
    if(!enabled||!isAnswerableTurn(turn))return false;
    var role=String(turn.source_role||'manual');
    if(mode==='oral_copilot'){
      if(role==='system'||role==='manual')return true;
      return role==='user'&&loopbackEnabled===false;
    }
    if(mode==='meeting')return true;
    if(mode==='mock_oral_exam')return false;
    return role==='user'||role==='manual';
  }
  function runtimeReady(runtime){
    if(!runtime||runtime.enabled!==true||runtime.hasCredential!==true)return false;
    var state=String(runtime.lastState||'').toUpperCase();
    return !/AUTH_REQUIRED|FAILED|ERROR|REJECTED|NOT_CONFIGURED|DISABLED/.test(state);
  }
  function runtimeIssue(runtime){
    if(!runtime)return '';
    var state=String(runtime.lastState||'').toUpperCase();
    if(state==='AUTH_REQUIRED')return text(runtime.lastError,'کلید Gemini معتبر نیست یا اجازهٔ دسترسی ندارد.');
    if(/FAILED|ERROR|REJECTED/.test(state))return text(runtime.lastError,'سرویس AI نیاز به بررسی دارد.');
    return '';
  }
  function compactStageState(value){
    var state=String(value||'').toUpperCase();
    if(/AUTH_REQUIRED/.test(state))return 'AUTH';
    if(/READY_FOR_CONFIG|NOT_CONFIGURED|DISABLED/.test(state))return 'SETUP';
    if(/VALIDATION_READY/.test(state))return 'READY';
    if(/VALIDATION_ACTIVE|TRANSCRIBING|RUNNING/.test(state))return 'WORKING';
    if(/CAPTURING/.test(state))return 'LIVE';
    if(/RETRY/.test(state))return 'RETRY';
    return state||'—';
  }

  class App extends React.Component{
    constructor(props){
      super(props);
      this.state={
        token:'',version:'0.13.0',view:'session',theme:lsGet('theme','dark'),connection:'booting',
        health:null,metrics:null,native:null,asr:null,brainRuntime:null,
        sessions:[],sessionId:null,activeSessionId:null,sessionActive:false,currentSession:null,
        mode:lsGet('mode','oral_copilot'),mic:lsGet('mic',true),loopback:lsGet('loopback',true),chunkSeconds:Number(lsGet('chunkSeconds',5)),
        contextText:lsGet('contextText',''),responseStyle:lsGet('responseStyle','concise'),
        turns:[],transcripts:[],gaps:[],activity:[],selectedTurnId:null,selectedDetail:null,inspectorPinned:false,
        sources:[],retrieveResults:[],retrieveQuery:'',sourceTitle:'منبع جدید',sourceText:'',sourceFileName:'',
        apiKey:'',model:lsGet('model','gemini-3.1-flash-lite'),strictSource:lsGet('strictSource',true),autoAnswer:lsGet('autoAnswer',true),localAsrEnabled:lsGet('localAsrEnabled',false),localAsrUrl:lsGet('localAsrUrl','http://127.0.0.1:8080'),
        manualText:'',busySession:false,busyRuntime:false,busyManual:false,busySource:false,busyAnswer:false,busySettings:false,
        notice:null,lastSyncAt:null,conversationOpen:false,sessionsOpen:false,transcriptArchiveOpen:false
      };
      this.token='';this.pollTimer=null;this.metricsTimer=null;this.pollInFlight=false;this.noticeTimer=null;
    }

    componentDidMount(){
      document.documentElement.dataset.theme=this.state.theme;
      this.boundKeyDown=this.onGlobalKeyDown.bind(this);
      window.addEventListener('keydown',this.boundKeyDown);
      this.bootstrap();
    }
    componentWillUnmount(){
      clearInterval(this.pollTimer);clearInterval(this.metricsTimer);clearTimeout(this.noticeTimer);
      if(this.boundKeyDown)window.removeEventListener('keydown',this.boundKeyDown);
    }

    setNotice(message,tone){
      var value=text(message,'خطای ناشناخته');
      clearTimeout(this.noticeTimer);
      this.setState({notice:{text:value,tone:tone||'neutral'}});
      this.noticeTimer=setTimeout(function(){this.setState({notice:null});}.bind(this),5200);
    }

    async api(path,options){
      options=options||{};
      var headers=new Headers(options.headers||{});
      var token=this.token||this.state.token;
      if(token)headers.set('x-auralis-token',token);
      if(options.body&&!headers.has('content-type'))headers.set('content-type','application/json');
      var res=await fetch(path,Object.assign({},options,{headers:headers}));
      var data={};
      try{data=await res.json();}catch(e){}
      if(!res.ok){
        var raw=data.message!==undefined?data.message:data.error!==undefined?data.error:'HTTP '+res.status;
        var error=new Error(text(raw,'HTTP '+res.status));error.status=res.status;error.data=data;throw error;
      }
      return data;
    }

    async bootstrap(){
      this.setState({connection:'connecting'});
      try{
        var response=await fetch('/v1/bootstrap');
        if(!response.ok)throw new Error('Bootstrap HTTP '+response.status);
        var bootstrap=await response.json();
        this.token=String(bootstrap.token||'');
        this.setState({token:this.token,version:String(bootstrap.version||'0.13.0')});
        var sessionData=await this.refreshSessions();
        await Promise.all([this.refreshHealth(),this.refreshNative(),this.refreshRuntime(),this.refreshMetrics(),this.refreshSources()]);
        var sessions=sessionData&&sessionData.sessions||[];
        var preferred=(sessionData&&sessionData.activeSessionId)||lsGet('lastSessionId',null)||(sessions[0]&&sessions[0].id);
        if(preferred&&sessions.some(function(item){return item.id===preferred;}))await this.openSession(preferred,true);
        this.setState({connection:'online',lastSyncAt:new Date().toISOString()});
        this.pollTimer=setInterval(function(){this.poll();}.bind(this),1000);
        this.metricsTimer=setInterval(function(){this.refreshMetrics();}.bind(this),5000);
      }catch(error){
        this.setState({connection:'offline'});
        this.setNotice('اتصال رابط به هسته برقرار نشد: '+text(error&&error.message),'danger');
      }
    }

    async poll(){
      if(this.pollInFlight)return;
      this.pollInFlight=true;
      try{
        await Promise.all([this.refreshHealth(),this.refreshNative(),this.refreshRuntime(),this.refreshSessions(),this.refreshCurrentSessionData()]);
        this.setState({connection:'online',lastSyncAt:new Date().toISOString()});
      }catch(error){this.setState({connection:'degraded'});}
      finally{this.pollInFlight=false;}
    }

    async refreshHealth(){var data=await this.api('/v1/health');this.setState({health:data});return data;}
    async refreshMetrics(){try{var data=await this.api('/v1/metrics/summary');this.setState({metrics:data,brainRuntime:data.brainRuntime||this.state.brainRuntime});return data;}catch(error){return null;}}
    async refreshNative(){
      var data=await this.api('/v1/native-capture/status');
      var active=isCaptureActive(data.state)&&Boolean(data.sessionId);
      this.setState({native:data,activeSessionId:active?data.sessionId:null,sessionActive:active});
      return data;
    }
    async refreshRuntime(){var data=await this.api('/v1/asr/status');var local=data&&data.localFallback||{};this.setState({asr:data,localAsrEnabled:Boolean(local.enabled),localAsrUrl:text(local.baseUrl,this.state.localAsrUrl)});return data;}
    async refreshSources(){try{var data=await this.api('/v1/sources');this.setState({sources:data.sources||[]});return data;}catch(error){return null;}}
    async refreshSessions(){
      var data=await this.api('/v1/sessions?limit=24');
      var current=(data.sessions||[]).filter(function(item){return item.id===this.state.sessionId;},this)[0]||this.state.currentSession;
      this.setState({sessions:data.sessions||[],currentSession:current,activeSessionId:data.activeSessionId||null,sessionActive:isCaptureActive(data.captureState)&&Boolean(data.activeSessionId)});
      return data;
    }
    async refreshCurrentSessionData(){
      if(!this.state.sessionId)return null;
      var id=this.state.sessionId;
      var results=await Promise.all([
        this.api('/v1/sessions/'+id+'/turns'),
        this.api('/v1/sessions/'+id+'/transcripts?limit=80'),
        this.api('/v1/sessions/'+id+'/gaps'),
        this.api('/v1/sessions/'+id+'/activity?limit=50')
      ]);
      var turns=results[0].turns||[];
      var selected=this.state.selectedTurnId;
      if(selected&&!turns.some(function(turn){return turn.id===selected;}))selected=null;
      if(!this.state.inspectorPinned){
        var liveCandidate=turns.find(function(turn){return isAnswerableTurn(turn)&&Boolean(turn.answer_id||turn.answer_text);})
          || turns.find(function(turn){return isAnswerableTurn(turn);})
          || null;
        if(liveCandidate)selected=liveCandidate.id;
      }
      var detail=this.state.selectedDetail;
      var selectedRow=selected?turns.find(function(turn){return turn.id===selected;}):null;
      var currentAnswerId=detail&&detail.latestAnswer&&detail.latestAnswer.id;
      var shouldRefreshDetail=Boolean(selected)&&(
        !detail||!detail.turn||detail.turn.id!==selected||
        (selectedRow&&selectedRow.answer_id&&selectedRow.answer_id!==currentAnswerId)
      );
      if(shouldRefreshDetail){
        try{detail=await this.api('/v1/turns/'+selected);}catch(error){detail=null;}
      } else if(!selected){detail=null;}
      this.setState({
        turns:turns,
        transcripts:results[1].transcripts||[],
        gaps:results[2].gaps||[],
        activity:results[3].activity||[],
        selectedTurnId:selected,
        selectedDetail:detail
      });
      return results;
    }

    async openSession(id,silent){
      if(!id)return;
      if(this.state.sessionActive&&this.state.activeSessionId&&id!==this.state.activeSessionId){if(!silent)this.setNotice('برای مشاهدهٔ جلسهٔ قبلی، ابتدا جلسهٔ فعال را متوقف کن.','warning');return;}
      var selected=this.state.sessions.filter(function(item){return item.id===id;})[0]||null;
      this.setState({sessionId:id,currentSession:selected,selectedTurnId:null,selectedDetail:null,inspectorPinned:false,turns:[],transcripts:[],gaps:[],activity:[]});
      lsSet('lastSessionId',id);
      try{await this.refreshCurrentSessionData();}catch(error){if(!silent)this.setNotice('بارگذاری جلسه ناموفق بود: '+error.message,'danger');}
    }

    onGlobalKeyDown(event){
      if(!event||event.defaultPrevented||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
      if(String(event.key||'')==='Escape'&&(this.state.conversationOpen||this.state.sessionsOpen||this.state.transcriptArchiveOpen)){
        event.preventDefault();
        this.setState({conversationOpen:false,sessionsOpen:false,transcriptArchiveOpen:false});
        return;
      }
      if(isEditableTarget(event.target)||String(event.key||'').toLowerCase()!=='z')return;
      event.preventDefault();
      this.answerHotkey();
    }

    preferredHotkeyTurn(){
      var selected=this.state.turns.find(function(turn){return turn.id===this.state.selectedTurnId;},this);
      if(isAnswerableTurn(selected))return selected;
      return this.state.turns.find(function(turn){return isAnswerableTurn(turn);})||null;
    }

    async ensureTurnAnswer(turn,options){
      options=options||{};
      if(!isAnswerableTurn(turn)){this.setNotice('Turn انتخاب‌شده سؤال یا درخواست نیست.','warning');return null;}
      var pin=options.pin===true;
      if(pin)this.setState({inspectorPinned:true});
      if(turn.answer_id||turn.answer_text){
        await this.selectTurn(turn.id,{pin:pin});
        this.setNotice(options.fromHotkey?'Z · پاسخ آماده نمایش داده شد.':'پاسخ آماده است.','success');
        return turn;
      }
      if(!(this.state.brainRuntime&&this.state.brainRuntime.enabled)){
        this.setNotice('برای ساخت پاسخ، ابتدا AI را فعال کن.','warning');
        return null;
      }
      this.setState({busyAnswer:true});
      try{
        var key='auto:'+turn.id+':fast:'+this.state.model+':'+(this.state.strictSource?'strict':'open');
        await this.api('/v1/turns/'+turn.id+'/answer',{method:'POST',body:JSON.stringify({apiKey:this.state.apiKey.trim(),model:this.state.model,strictSource:this.state.strictSource,lane:'fast',idempotencyKey:key})});
        await this.refreshCurrentSessionData();
        await this.selectTurn(turn.id,{pin:pin});
        this.setNotice(options.fromHotkey?'Z · پاسخ Turn آماده شد.':'پاسخ به Turn متصل و ثبت شد.','success');
        return turn;
      }catch(error){this.setNotice('ساخت پاسخ ناموفق: '+error.message,'danger');return null;}
      finally{this.setState({busyAnswer:false});}
    }

    async answerHotkey(){
      var turn=this.preferredHotkeyTurn();
      if(!turn){this.setNotice('Z · هنوز سؤال یا درخواستی برای پاسخ وجود ندارد.','warning');return;}
      await this.ensureTurnAnswer(turn,{pin:Boolean(this.state.selectedTurnId===turn.id),fromHotkey:true});
    }

    followLive(){
      this.setState({inspectorPinned:false},function(){this.refreshCurrentSessionData();}.bind(this));
    }

    setTheme(theme){document.documentElement.dataset.theme=theme;lsSet('theme',theme);this.setState({theme:theme});}
    changeMode(value){lsSet('mode',value);this.setState({mode:value});}
    changePreference(key,value){lsSet(key,value);var patch={};patch[key]=value;this.setState(patch);}

    async startSession(){
      if(this.state.busySession||this.state.sessionActive)return;
      if(!this.state.mic&&!this.state.loopback){this.setNotice('حداقل میکروفون یا صدای سیستم را فعال کن.','warning');return;}
      this.setState({busySession:true});
      var createdId=null;
      try{
        var session=await this.api('/v1/sessions',{method:'POST',body:JSON.stringify({mode:this.state.mode,contextText:this.state.contextText,responseStyle:this.state.responseStyle})});
        createdId=session.id;
        await this.api('/v1/native-capture/start',{method:'POST',body:JSON.stringify({sessionId:createdId,mic:this.state.mic,loopback:this.state.loopback,chunkSeconds:Number(this.state.chunkSeconds)||5})});
        this.setState({sessionId:createdId,activeSessionId:createdId,sessionActive:true,currentSession:null,selectedTurnId:null,selectedDetail:null,inspectorPinned:false,turns:[],transcripts:[],gaps:[],activity:[]});
        lsSet('lastSessionId',createdId);
        await Promise.all([this.refreshSessions(),this.refreshNative(),this.refreshCurrentSessionData()]);
        this.setNotice('جلسه و ثبت ماندگار صوت فعال شد.','success');
      }catch(error){
        if(createdId){try{await this.api('/v1/sessions/'+createdId+'/stop',{method:'POST',body:'{}'});}catch(ignore){}}
        this.setNotice('شروع جلسه ناموفق: '+error.message,'danger');
      }finally{this.setState({busySession:false});}
    }

    async stopSession(){
      var id=this.state.activeSessionId||this.state.sessionId;
      if(!id||this.state.busySession)return;
      this.setState({busySession:true});
      try{
        await this.api('/v1/sessions/'+id+'/stop',{method:'POST',body:'{}'});
        this.setState({sessionActive:false,activeSessionId:null});
        await Promise.all([this.refreshNative(),this.refreshSessions(),this.refreshCurrentSessionData()]);
        this.setNotice('جلسه بسته شد؛ صوت و Turnها در دفتر باقی ماندند.','neutral');
      }catch(error){this.setNotice('پایان جلسه ناموفق: '+error.message,'danger');}
      finally{this.setState({busySession:false});}
    }

    async saveSessionSettings(){
      lsSet('contextText',this.state.contextText);lsSet('responseStyle',this.state.responseStyle);
      if(!this.state.sessionId){this.setNotice('تنظیمات به‌عنوان پیش‌فرض جلسهٔ بعد ذخیره شد.','success');return;}
      this.setState({busySettings:true});
      try{
        var data=await this.api('/v1/sessions/'+this.state.sessionId,{method:'PATCH',body:JSON.stringify({contextText:this.state.contextText,responseStyle:this.state.responseStyle})});
        this.setState({currentSession:data.session||this.state.currentSession});
        await this.refreshSessions();
        this.setNotice('کانتکست و سبک پاسخ جلسه ذخیره شد.','success');
      }catch(error){this.setNotice('ذخیرهٔ تنظیمات جلسه ناموفق: '+error.message,'danger');}
      finally{this.setState({busySettings:false});}
    }

    async quickSetup(){
      if(!this.state.apiKey.trim()){this.setState({view:'settings'});this.setNotice('API Key را در تنظیمات وارد کن.','warning');return;}
      this.setState({busyRuntime:true});
      try{
        var data=await this.api('/v1/runtime/quick-setup',{method:'POST',body:JSON.stringify({sessionId:this.state.sessionId||'',apiKey:this.state.apiKey.trim(),model:this.state.model,strictSource:this.state.strictSource,autoAnswer:this.state.autoAnswer})});
        this.setState({asr:data.asr,brainRuntime:data.brain});
        await Promise.all([this.refreshRuntime(),this.refreshHealth()]);
        this.setNotice('ASR و Brain برای این اجرا فعال شدند.','success');
      }catch(error){this.setNotice('فعال‌سازی AI ناموفق: '+error.message,'danger');}
      finally{this.setState({busyRuntime:false});}
    }

    async saveLocalAsr(){
      this.setState({busyRuntime:true});
      try{
        var data=await this.api('/v1/asr/local-config',{method:'POST',body:JSON.stringify({enabled:this.state.localAsrEnabled,baseUrl:this.state.localAsrUrl,language:'fa',model:'whisper.cpp-local'})});
        lsSet('localAsrEnabled',this.state.localAsrEnabled);lsSet('localAsrUrl',this.state.localAsrUrl);
        await Promise.all([this.refreshRuntime(),this.refreshHealth()]);
        this.setNotice(data.enabled?'Fallback محلی whisper.cpp فعال شد.':'Fallback محلی غیرفعال شد.','success');
      }catch(error){this.setNotice('تنظیم ASR محلی ناموفق: '+error.message,'danger');}
      finally{this.setState({busyRuntime:false});}
    }

    async probeLocalAsr(){
      this.setState({busyRuntime:true});
      try{var data=await this.api('/v1/asr/local-probe',{method:'POST',body:JSON.stringify({baseUrl:this.state.localAsrUrl})});this.setNotice('whisper.cpp روی loopback در دسترس است · '+text(data.latencyMs,0)+' ms','success');}
      catch(error){this.setNotice('whisper.cpp محلی در دسترس نیست: '+error.message,'warning');}
      finally{this.setState({busyRuntime:false});}
    }

    async testBrain(){
      if(!this.state.apiKey.trim()){this.setNotice('API Key لازم است.','warning');return;}
      this.setState({busyRuntime:true});
      try{await this.api('/v1/brain/test',{method:'POST',body:JSON.stringify({apiKey:this.state.apiKey.trim(),model:this.state.model})});this.setNotice('اتصال Brain تأیید شد.','success');}
      catch(error){this.setNotice('تست Brain ناموفق: '+error.message,'danger');}
      finally{this.setState({busyRuntime:false});}
    }

    async selectTurn(id,options){
      options=options||{};
      var pin=options.pin!==false;
      this.setState({selectedTurnId:id,inspectorPinned:pin});
      try{var data=await this.api('/v1/turns/'+id);this.setState({selectedDetail:data});}
      catch(error){this.setNotice('جزئیات Turn دریافت نشد: '+error.message,'danger');}
    }

    async answerSelected(){
      var detail=this.state.selectedDetail;
      if(!detail||!detail.turn)return;
      await this.ensureTurnAnswer(detail.turn,{pin:true});
    }

    async submitManual(answerToo){
      var value=this.state.manualText.trim();
      if(!value)return;
      if(!this.state.sessionId||!this.state.sessionActive){this.setNotice('برای ثبت ورودی دستی، جلسهٔ فعال لازم است.','warning');return;}
      this.setState({busyManual:true});
      try{
        var request=await this.api('/v1/questions',{method:'POST',body:JSON.stringify({sessionId:this.state.sessionId,text:value,clientRequestId:'ui-'+Date.now()+'-'+Math.random().toString(16).slice(2)})});
        this.setState({manualText:'',selectedTurnId:request.turn.id,inspectorPinned:false});
        if(answerToo&&request.route&&request.route.shouldAnswer){var manualKey='auto:'+request.turn.id+':fast:'+this.state.model+':'+(this.state.strictSource?'strict':'open');await this.api('/v1/turns/'+request.turn.id+'/answer',{method:'POST',body:JSON.stringify({apiKey:this.state.apiKey.trim(),model:this.state.model,strictSource:this.state.strictSource,lane:'fast',idempotencyKey:manualKey})});}
        await this.refreshCurrentSessionData();await this.selectTurn(request.turn.id,{pin:false});
      }catch(error){this.setNotice('ثبت ورودی دستی ناموفق: '+error.message,'danger');}
      finally{this.setState({busyManual:false});}
    }

    async retranscribe(segmentId){
      try{await this.api('/v1/segments/'+segmentId+'/retranscribe',{method:'POST',body:'{}'});this.setNotice('بازرونویسی در صف ماندگار قرار گرفت.','success');}
      catch(error){this.setNotice('بازرونویسی ناموفق: '+error.message,'danger');}
    }

    onSourceFile(event){
      var file=event.target.files&&event.target.files[0];if(!file)return;
      var reader=new FileReader();
      reader.onload=function(){this.setState({sourceText:String(reader.result||''),sourceFileName:file.name,sourceTitle:file.name.replace(/\.[^.]+$/,'')});}.bind(this);
      reader.readAsText(file,'utf-8');
    }
    async importSource(){
      var value=this.state.sourceText.trim();if(!value){this.setNotice('متن یا فایل منبع را وارد کن.','warning');return;}
      this.setState({busySource:true});
      try{var data=await this.api('/v1/sources',{method:'POST',body:JSON.stringify({title:this.state.sourceTitle||this.state.sourceFileName||'Source',text:value,mimeType:'text/plain'})});this.setState({sourceText:'',sourceFileName:''});await this.refreshSources();this.setNotice('منبع در '+data.document.chunks+' قطعه ایندکس شد.','success');}
      catch(error){this.setNotice('ایندکس منبع ناموفق: '+error.message,'danger');}
      finally{this.setState({busySource:false});}
    }
    async deleteSource(id){try{await this.api('/v1/sources/'+id,{method:'DELETE'});await this.refreshSources();this.setNotice('منبع حذف شد.','neutral');}catch(error){this.setNotice('حذف منبع ناموفق: '+error.message,'danger');}}
    async retrieve(){var query=this.state.retrieveQuery.trim();if(!query)return;try{var data=await this.api('/v1/retrieve',{method:'POST',body:JSON.stringify({query:query,limit:8})});this.setState({retrieveResults:data.results||[]});}catch(error){this.setNotice('آزمون بازیابی ناموفق: '+error.message,'danger');}}
    async retryFailed(){try{var data=await this.api('/v1/asr/retry-failed',{method:'POST',body:JSON.stringify({sessionId:this.state.sessionId||''})});this.setNotice(data.queued+' قطعه دوباره صف شد.','success');}catch(error){this.setNotice('تلاش مجدد ASR ناموفق: '+error.message,'danger');}}
    async exportDiagnostics(){
      try{var data=await this.api('/v1/diagnostics/export');var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});var url=URL.createObjectURL(blob);var anchor=document.createElement('a');anchor.href=url;anchor.download='auralis-diagnostics-'+Date.now()+'.json';anchor.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
      catch(error){this.setNotice('خروجی Diagnostics ساخته نشد: '+error.message,'danger');}
    }

    openConversationHub(){this.setState({conversationOpen:true,sessionsOpen:false,transcriptArchiveOpen:false});}
    openSessionsDrawer(){this.setState({sessionsOpen:true,conversationOpen:false,transcriptArchiveOpen:false});}
    openTranscriptArchive(){this.setState({transcriptArchiveOpen:true,conversationOpen:false,sessionsOpen:false});}
    closeOverlays(){this.setState({conversationOpen:false,sessionsOpen:false,transcriptArchiveOpen:false});}

    async chooseTurnFromHub(id){
      this.setState({conversationOpen:false});
      await this.selectTurn(id,{pin:true});
    }
    async chooseSessionFromDrawer(id){
      this.setState({sessionsOpen:false});
      await this.openSession(id);
    }

    renderSessionSummaryStrip(){
      var session=this.state.currentSession||this.state.sessions.filter(function(item){return item.id===this.state.sessionId;},this)[0];
      var mode=modeMeta(session&&session.mode||this.state.mode);
      return h('div',{className:'session-summary-strip'},
        h('div',{className:'summary-primary'},h(Chip,{tone:this.state.sessionActive?'success':'neutral',dot:true,active:this.state.sessionActive},this.state.sessionActive?'LIVE':'IDLE'),h('strong',null,this.state.sessionId?'جلسهٔ جاری':'هنوز جلسه‌ای شروع نشده')),
        this.state.sessionId?h('div',{className:'summary-facts'},
          h('span',null,h('small',null,'حالت'),h('b',null,mode.label)),
          h('span',null,h('small',null,'مدت'),h('b',null,formatDuration(session&&session.started_at,session&&session.ended_at))),
          h('span',null,h('small',null,'Turn'),h('b',null,String(this.state.turns.length))),
          h('span',null,h('small',null,'Gap'),h('b',{className:this.state.gaps.length?'danger-text':''},String(this.state.gaps.length)))
        ):h('span',{className:'summary-hint'},'با شروع جلسه، متن زنده و پاسخ‌ها به‌صورت خودکار آماده می‌شوند.'),
        h('div',{className:'summary-actions'},
          h(Button,{variant:'soft',tone:'primary',disabled:!this.state.sessionId,onClick:this.openConversationHub.bind(this)},'مکالمات '+this.state.turns.length)
        )
      );
    }

    renderConversationHub(){
      if(!this.state.conversationOpen)return null;
      var sessionMode=(this.state.currentSession&&this.state.currentSession.mode)||this.state.mode;
      var turns=this.state.turns.slice();
      return h('div',{className:'overlay-shell',role:'presentation',onMouseDown:function(e){if(e.target===e.currentTarget)this.closeOverlays();}.bind(this)},
        h('section',{className:'modal-panel conversation-hub',role:'dialog','aria-modal':'true','aria-label':'مکالمات این جلسه'},
          h('header',{className:'modal-head'},h('div',null,h('span',{className:'eyebrow'},'SESSION CONVERSATION'),h('h2',null,'مکالمات این جلسه'),h('p',null,'هر سؤال و پاسخ یک Turn مستقل است؛ پاسخ‌های آماده فقط نمایش داده می‌شوند و دوباره ساخته نمی‌شوند.')),h(Button,{variant:'icon',tone:'neutral',onClick:this.closeOverlays.bind(this),title:'بستن'},'×')),
          h('div',{className:'hub-summary'},h(Chip,{tone:'primary'},turns.length+' Turn'),h(Chip,{tone:'success'},turns.filter(function(t){return Boolean(t.answer_text);}).length+' پاسخ آماده'),h('span',null,'Z = پاسخ فوری Turn انتخاب‌شده')),
          h('div',{className:'hub-turn-list'},turns.length?turns.map(function(turn){var autoExpected=shouldAutoAnswerUi(turn,sessionMode,this.state.autoAnswer,this.state.loopback);return h('button',{type:'button',key:turn.id,className:'hub-turn-row',onClick:function(){this.chooseTurnFromHub(turn.id);}.bind(this)},
            h('div',{className:'hub-turn-meta'},h('span',{className:'turn-number'},'Turn '+text(turn.ordinal)),h(Chip,{tone:turn.source_role==='system'?'purple':'blue'},roleLabel(turn.source_role)),isAnswerableTurn(turn)?h(Chip,{tone:turn.answer_text?'success':autoExpected?'warning':'neutral',dot:true,active:Boolean(turn.answer_text)},turn.answer_text?'پاسخ آماده':autoExpected?'در حال آماده‌سازی':'دستی'):null,h('time',null,formatTime(turn.created_at))),
            h('div',{className:'hub-turn-question'},text(turn.text_raw,'')),
            turn.answer_text?h('div',{className:'hub-turn-answer'},text(turn.answer_text)):null
          );},this):h(Empty,{symbol:'Q',title:'هنوز مکالمه‌ای ثبت نشده',text:'پس از رونویسی سؤال‌ها، همه Turnها در این پنجره در دسترس خواهند بود.'}))
        )
      );
    }

    renderSessionsDrawer(){
      if(!this.state.sessionsOpen)return null;
      return h('div',{className:'overlay-shell drawer-overlay',role:'presentation',onMouseDown:function(e){if(e.target===e.currentTarget)this.closeOverlays();}.bind(this)},
        h('aside',{className:'sessions-drawer',role:'dialog','aria-modal':'true','aria-label':'جلسات اخیر'},
          h('header',{className:'drawer-head'},h('div',null,h('span',{className:'eyebrow'},'HISTORY'),h('h2',null,'جلسات اخیر'),h('p',null,'جلسه‌های قبلی خارج از Workspace اصلی نگه داشته می‌شوند.')),h(Button,{variant:'icon',tone:'neutral',onClick:this.closeOverlays.bind(this)},'×')),
          h('div',{className:'drawer-session-list'},this.state.sessions.length?this.state.sessions.map(function(item){var selected=item.id===this.state.sessionId;return h('button',{type:'button',key:item.id,className:'drawer-session-row'+(selected?' selected':''),onClick:function(){this.chooseSessionFromDrawer(item.id);}.bind(this)},h('div',{className:'drawer-session-top'},h('strong',null,modeMeta(item.mode).label),h(Chip,{tone:selected?'primary':'neutral'},String(item.turn_count||0)+' Turn')),h('div',{className:'drawer-session-bottom'},h('span',null,formatDate(item.started_at)+' · '+formatTime(item.started_at)),h('span',{dir:'ltr'},shortId(item.id))));},this):h(Empty,{symbol:'H',title:'جلسهٔ قبلی وجود ندارد'}))
        )
      );
    }

    renderTranscriptArchive(){
      if(!this.state.transcriptArchiveOpen)return null;
      return h('div',{className:'overlay-shell',role:'presentation',onMouseDown:function(e){if(e.target===e.currentTarget)this.closeOverlays();}.bind(this)},
        h('section',{className:'modal-panel transcript-archive',role:'dialog','aria-modal':'true','aria-label':'متن کامل جلسه'},
          h('header',{className:'modal-head'},h('div',null,h('span',{className:'eyebrow'},'TRANSCRIPT ARCHIVE'),h('h2',null,'متن کامل جلسه'),h('p',null,'جدیدترین قطعه در بالا؛ این بخش فقط رونویسی صوت را نمایش می‌دهد و پاسخ‌ها در آن تکرار نمی‌شوند.')),h(Button,{variant:'icon',tone:'neutral',onClick:this.closeOverlays.bind(this)},'×')),
          h('div',{className:'archive-transcript-list'},this.state.transcripts.length?this.state.transcripts.map(function(item){return h('article',{key:item.segment_id,className:'archive-transcript-row'},h('div',{className:'archive-transcript-meta'},h(Chip,{tone:sourceRoleFromChannel(item.channel_id)==='system'?'purple':'blue'},roleLabel(sourceRoleFromChannel(item.channel_id))),h('span',null,Math.round(Number(item.duration_ms||0))+' ms'),h('span',null,text(item.asr_status||item.segment_state))),h('div',{className:'archive-transcript-text'},text(item.text_raw,item.asr_error?'خطا: '+text(item.asr_error):'در حال پردازش…')),item.asr_error?h(Button,{variant:'soft',tone:'warning',onClick:function(){this.retranscribe(item.segment_id);}.bind(this)},'بازرونویسی'):null);},this):h(Empty,{symbol:'T',title:'متنی ثبت نشده'}))
        )
      );
    }

    renderOverlays(){return h(React.Fragment,null,this.renderConversationHub(),this.renderSessionsDrawer(),this.renderTranscriptArchive());}

    renderTop(){
      var healthStatus=text(this.state.health&&this.state.health.status,'connecting').toUpperCase();
      var healthTone=toneForState(healthStatus);
      return h('header',{className:'appbar'},
        h('div',{className:'brand-block'},h('div',{className:'brand-mark','aria-hidden':'true'},h('span',{className:'brand-wave'},h('i'),h('i'),h('i'),h('i'))),h('div',null,h('div',{className:'brand-line'},h('span',{className:'brand-name'},'Auralis'),h('span',{className:'brand-edition'},'Direct Audio Workspace')),h('div',{className:'brand-version'},'v0.13.0 · Speech Engine Reliability'))),
        h('nav',{className:'top-nav','aria-label':'بخش‌های برنامه'},NAV_ITEMS.map(function(item){
          var active=this.state.view===item.value;
          return h('button',{key:item.value,type:'button',className:'nav-item'+(active?' active':''),onClick:function(){this.setState({view:item.value});}.bind(this),'aria-current':active?'page':undefined},h('span',null,item.label),h('small',null,item.caption));
        },this)),
        h('div',{className:'top-actions'},h(Chip,{tone:healthTone,dot:true,active:healthTone==='success'},healthStatus),this.state.sessionActive?h(Chip,{tone:'primary',dot:true,active:true},'جلسه فعال'):h(Chip,{tone:'neutral'},'آماده'),h(Button,{variant:'soft',tone:'neutral',className:'top-history-btn',onClick:this.openSessionsDrawer.bind(this),title:'جلسات اخیر'},'جلسات'),h(Button,{variant:'icon',tone:'neutral',onClick:function(){this.setTheme(this.state.theme==='dark'?'light':'dark');}.bind(this),title:'تغییر پوسته'},this.state.theme==='dark'?'روز':'شب'))
      );
    }

    renderPipeline(){
      var components=this.state.health&&this.state.health.components||{};
      var captureState=this.state.sessionActive?(components.captureMic&&components.captureMic.state||components.captureSystem&&components.captureSystem.state||'STARTING'):'READY';
      var stages=[
        {label:'دریافت صوت',state:captureState,detail:(this.state.mic?'Mic ':'')+(this.state.loopback?'System':'')},
        {label:'ثبت ماندگار',state:components.spoolWriter&&components.spoolWriter.state||'READY',detail:'Audio ledger'},
        {label:'مرزبندی گفتار',state:components.vad&&components.vad.state||'READY',detail:'Derived segments'},
        {label:'رونویسی',state:components.asrPrimary&&components.asrPrimary.state||'NOT_CONFIGURED',detail:text(this.state.asr&&this.state.asr.provider,'ASR')},
        {label:'تشخیص سؤال',state:components.router&&components.router.state||'READY',detail:'Persian router'},
        {label:'ساخت پاسخ',state:components.brain&&components.brain.state||'READY_FOR_CONFIG',detail:text(this.state.brainRuntime&&this.state.brainRuntime.model,this.state.model)}
      ];
      return h('div',{className:'pipeline-list'},stages.map(function(stage,index){return h(PipelineStage,{key:stage.label,index:index+1,label:stage.label,state:compactStageState(stage.state),detail:stage.detail,tone:toneForState(stage.state)});}));
    }

    renderSessionRail(){
      var session=this.state.currentSession||this.state.sessions.filter(function(item){return item.id===this.state.sessionId;},this)[0];
      var recent=this.state.sessions.slice(0,4);
      return h('aside',{className:'session-rail'},
        h(Surface,{className:'rail-card current-session-card'},h(SectionHead,{eyebrow:'CURRENT SESSION',title:this.state.sessionId?'جلسهٔ جاری':'بدون جلسه',level:'h3',action:h(Chip,{tone:this.state.sessionActive?'success':'neutral',dot:true,active:this.state.sessionActive},this.state.sessionActive?'LIVE':'IDLE')}),
          this.state.sessionId?h('div',{className:'session-facts'},h('div',null,h('span',null,'شناسه'),h('strong',{dir:'ltr'},shortId(this.state.sessionId))),h('div',null,h('span',null,'حالت'),h('strong',null,modeMeta(session&&session.mode||this.state.mode).label)),h('div',null,h('span',null,'مدت'),h('strong',null,formatDuration(session&&session.started_at,session&&session.ended_at))),h('div',null,h('span',null,'شکاف'),h('strong',{className:this.state.gaps.length?'danger-text':''},String(this.state.gaps.length)))):h('p',{className:'muted-copy'},'برای ساخت timeline صوت و متن، یک جلسه شروع کن.')),
        h(Surface,{className:'rail-card pipeline-card'},h(SectionHead,{eyebrow:'LIVE CYCLE',title:'چرخهٔ پردازش',level:'h3'}),this.renderPipeline()),
        h(Surface,{className:'rail-card history-card'},h(SectionHead,{eyebrow:'HISTORY',title:'جلسات اخیر',level:'h3',action:h(Chip,{tone:'neutral'},String(this.state.sessions.length))}),recent.length?h('div',{className:'session-history-list'},recent.map(function(item){var active=item.id===this.state.sessionId;return h('button',{type:'button',key:item.id,className:'session-history-row'+(active?' selected':''),onClick:function(){this.openSession(item.id);}.bind(this)},h('span',{className:'history-state '+toneForState(item.state)}),h('span',{className:'history-copy'},h('strong',null,modeMeta(item.mode).label),h('small',null,formatDate(item.started_at)+' · '+formatTime(item.started_at))),h('span',{className:'history-count'},String(item.turn_count||0)));},this)):h('p',{className:'muted-copy'},'هنوز سابقه‌ای ثبت نشده است.'))
      );
    }

    renderSessionCommand(){
      var asrReady=runtimeReady(this.state.asr)&&runtimeReady(this.state.brainRuntime);
      var sessionTone=this.state.sessionActive?'success':this.state.busySession?'warning':'primary';
      return h(Surface,{className:'session-command'},
        h('div',{className:'command-title'},h('span',{className:'eyebrow'},'SESSION CONTROL'),h('h1',null,this.state.sessionActive?'شنیدن و ثبت جلسه':'فضای شنیداری آماده است'),h('p',null,modeMeta(this.state.mode).hint)),
        h('div',{className:'command-controls'},
          h(Field,{label:'حالت جلسه',className:'compact-field'},h('select',{className:'modern-select',value:this.state.mode,disabled:this.state.sessionActive,onChange:function(event){this.changeMode(event.target.value);}.bind(this)},MODES.map(function(mode){return h('option',{key:mode.value,value:mode.value},mode.label+' · '+mode.short);}))),
          h('div',{className:'input-toggles'},h(ToggleButton,{label:'میکروفون',detail:'صدای شما',active:this.state.mic,disabled:this.state.sessionActive,onClick:function(){this.changePreference('mic',!this.state.mic);}.bind(this)}),h(ToggleButton,{label:'صدای سیستم',detail:'طرف مقابل',active:this.state.loopback,disabled:this.state.sessionActive,onClick:function(){this.changePreference('loopback',!this.state.loopback);}.bind(this)})),
          h('div',{className:'command-actions'},h(Button,{variant:'state',tone:sessionTone,active:this.state.sessionActive,loading:this.state.busySession,onClick:this.state.sessionActive?this.stopSession.bind(this):this.startSession.bind(this)},this.state.sessionActive?'پایان جلسه':'شروع جلسه'),h(Button,{variant:'state',tone:asrReady?'success':'primary',active:asrReady,loading:this.state.busyRuntime,onClick:this.quickSetup.bind(this)},asrReady?'AI فعال':'فعال‌سازی AI'))
        )
      );
    }

    renderTranscript(){
      var successful=this.state.transcripts.filter(function(item){return Boolean(String(item&&item.text_raw||'').trim());});
      var latest=successful[0];
      var recent=successful.slice(0,4);
      var asrReady=runtimeReady(this.state.asr);
      var issue=runtimeIssue(this.state.asr);
      return h(Surface,{className:'transcript-surface focus-transcript'},
        h(SectionHead,{eyebrow:'LIVE TRANSCRIPT',title:'متن زنده',subtitle:'فقط رونویسی موفق صوت؛ خطاهای سرویس به‌عنوان متن گفتگو نمایش داده نمی‌شوند.',action:h('div',{className:'transcript-head-actions'},h(Chip,{tone:latest?'success':issue?'danger':asrReady?'warning':'neutral',dot:true,active:Boolean(latest||asrReady)},latest?'FINAL':issue?'نیاز به اقدام':asrReady?'LISTENING':'ASR OFF'),h(Button,{variant:'soft',tone:'neutral',disabled:!this.state.transcripts.length,onClick:this.openTranscriptArchive.bind(this)},'متن کامل'))}),
        issue?h('div',{className:'runtime-inline-alert'},h('strong',null,'رونویسی متوقف شده'),h('span',null,issue),h(Button,{variant:'soft',tone:'warning',onClick:function(){this.setState({view:'settings'});}.bind(this)},'رفتن به تنظیمات')):null,
        recent.length?h('div',{className:'live-transcript-feed'},recent.map(function(item,index){return h('article',{key:item.segment_id,className:'live-transcript-row'+(index===0?' newest':'')},h('div',{className:'live-transcript-row-meta'},h(Chip,{tone:sourceRoleFromChannel(item.channel_id)==='system'?'purple':'blue'},roleLabel(sourceRoleFromChannel(item.channel_id))),h('span',null,formatTime(item.created_at||item.updated_at||new Date().toISOString())),index===0?h('span',{className:'live-now'},'جدیدترین'):null),h('div',{className:'live-transcript-copy'},text(item.text_raw,'')));},this)):h('div',{className:'latest-transcript empty-live'},issue?'صوت حفظ شده است؛ پس از اصلاح تنظیمات، قطعه‌های ناموفق دوباره رونویسی می‌شوند.':asrReady?'در حال شنیدن… پس از تثبیت گفتار، متن اینجا ظاهر می‌شود.':'ASR را از نوار کنترل یا تنظیمات فعال کن.'),
        latest?h('div',{className:'transcript-status-line'},h('span',null,roleLabel(sourceRoleFromChannel(latest.channel_id))),h('span',null,Math.round(Number(latest.duration_ms||0))+' ms'),h('span',null,text(latest.provider||latest.asr_status||latest.segment_state))):null
      );
    }

    renderTurns(){
      var sessionMode=(this.state.currentSession&&this.state.currentSession.mode)||this.state.mode;
      return h(Surface,{className:'turns-surface'},
        h(SectionHead,{eyebrow:'CONVERSATION',title:'پرسش‌ها و پاسخ‌ها',subtitle:'هر Turn مستقل است و نتیجهٔ دیررس به Turn دیگری متصل نمی‌شود.',action:h(Chip,{tone:'neutral'},String(this.state.turns.length))}),
        h('div',{className:'turn-list'},this.state.turns.length?this.state.turns.map(function(turn){var selected=this.state.selectedTurnId===turn.id;var autoExpected=shouldAutoAnswerUi(turn,sessionMode,this.state.autoAnswer,this.state.loopback);return h('button',{type:'button',key:turn.id,className:'turn-card'+(selected?' selected':''),onClick:function(){this.selectTurn(turn.id,{pin:true});}.bind(this)},h('div',{className:'turn-card-top'},h('div',{className:'turn-identity'},h('span',{className:'turn-number'},'Turn '+text(turn.ordinal)),h(Chip,{tone:turn.source_role==='system'?'purple':'blue'},roleLabel(turn.source_role)),isAnswerableTurn(turn)?h(Chip,{tone:turn.answer_text?'success':autoExpected?'warning':'neutral',dot:true,active:Boolean(turn.answer_text)},turn.answer_text?'پاسخ آماده':autoExpected?'در حال آماده‌سازی':'دستی'):null),h('span',{className:'turn-time'},formatTime(turn.created_at))),h('div',{className:'turn-question'},text(turn.text_raw,'')),turn.answer_text?h('div',{className:'turn-answer-preview'},text(turn.answer_text)):h('div',{className:'turn-answer-empty'},isAnswerableTurn(turn)?(autoExpected?'پاسخ در پس‌زمینه ساخته می‌شود · Z برای اولویت فوری':'Z برای ساخت پاسخ دستی این Turn'):'جملهٔ خبری · بدون درخواست Brain'));},this):h(Empty,{symbol:'T',title:'هنوز Turn ثبت نشده',text:'گفتار رونویسی‌شده یا سؤال دستی به‌صورت کارت مستقل ظاهر می‌شود.'})),
        h('div',{className:'manual-composer'},h('textarea',{value:this.state.manualText,disabled:!this.state.sessionActive,onChange:function(event){this.setState({manualText:event.target.value});}.bind(this),placeholder:this.state.sessionActive?'ورودی دستی اختیاری…  |  Z = پاسخ Turn انتخاب‌شده یا آخرین سؤال':'ابتدا جلسه را شروع کن…'}),h('div',{className:'composer-actions'},h(Button,{variant:'soft',tone:'neutral',disabled:!this.state.sessionActive||!this.state.manualText.trim()||this.state.busyManual,onClick:function(){this.submitManual(false);}.bind(this)},'فقط ثبت'),h(Button,{variant:'soft',tone:'primary',loading:this.state.busyManual,disabled:!this.state.sessionActive||!this.state.manualText.trim(),onClick:function(){this.submitManual(true);}.bind(this)},'ثبت و پاسخ')))
      );
    }

    renderInspector(){
      var detail=this.state.selectedDetail;
      if(!detail||!detail.turn)return h(Surface,{className:'inspector-surface'},h(Empty,{symbol:'Q',title:'یک Turn را انتخاب کن',text:'پرسش، پاسخ، منبع و اتصال آن به قطعهٔ صوتی در این بخش نمایش داده می‌شود.'}));
      var answer=detail.latestAnswer,answerable=['question','request'].indexOf(detail.turn.kind)>=0,retrieved=answer&&answer.retrieved||[],cited=new Set(answer&&answer.sourceChunkIds||[]);
      return h(Surface,{className:'inspector-surface'},
        h(SectionHead,{eyebrow:'TURN INSPECTOR',title:'جزئیات پاسخ',action:h('div',{className:'inspector-head-actions'},h(Chip,{tone:detail.turn.source_role==='system'?'purple':'blue'},roleLabel(detail.turn.source_role)),this.state.inspectorPinned?h(Button,{variant:'soft',tone:'neutral',className:'follow-live-btn',onClick:this.followLive.bind(this)},'دنبال‌کردن زنده'):h(Chip,{tone:'success',dot:true,active:true},'LIVE'))}),
        h('div',{className:'inspector-question'},h('span',{className:'mini-caption'},'پرسش / درخواست'),h('div',{className:'big-copy'},text(detail.turn.text_raw,'')),h('div',{className:'route-meta'},h(Chip,{tone:answerable?'primary':'neutral'},text(detail.turn.kind)),h('span',null,text(detail.turn.route_reason)) )),
        h('div',{className:'inspector-answer'},h('span',{className:'mini-caption'},'پاسخ'),answer?h('div',{className:'answer-copy'},text(answer.answer)):h('div',{className:'answer-placeholder'},answerable?'هنوز پاسخی ثبت نشده است.':'این Turn خبری است و به Brain ارسال نمی‌شود.')),
        answerable&&!answer?h('div',{className:'answer-waiting'},h('span',null,shouldAutoAnswerUi(detail.turn,(this.state.currentSession&&this.state.currentSession.mode)||this.state.mode,this.state.autoAnswer,this.state.loopback)?'پاسخ خودکار در حال آماده‌سازی است.':'این Mode پاسخ خودکار این Turn را تولید نمی‌کند.'),h('kbd',null,'Z'),h('small',null,'پاسخ دستی / فوری')):null,
        answer?h('div',{className:'answer-foot'},h(Chip,{tone:answer.grounding==='source'?'success':answer.grounding==='grounding_unverified'?'danger':'neutral'},text(answer.grounding)),h('span',null,(answer.sourceChunkIds||[]).length+' استناد معتبر'),h('span',null,text(answer.model))):null,
        retrieved.length?h('details',{className:'sources-disclosure'},h('summary',null,'شواهد بازیابی‌شده'),h('div',{className:'evidence-list'},retrieved.map(function(item){return h('article',{key:item.chunkId,className:'evidence-card'+(cited.has(item.chunkId)?' cited':'')},h('div',{className:'evidence-title'},text(item.title,'منبع')),h('div',{className:'evidence-text'},text(item.excerpt,'')));}))):null,
        detail.segments&&detail.segments.length?h('details',{className:'technical-disclosure'},h('summary',null,'اتصال فنی Turn به صوت'),h('pre',null,detail.segments.map(function(segment){return 'segment '+shortId(segment.id)+'\nASR '+text(segment.transcript_provider)+' / '+text(segment.transcript_model)+'\nrevision '+text(segment.transcript_revision)+'\nseq '+text(segment.seq_start)+'..'+text(segment.seq_end);}).join('\n\n'))):null
      );
    }

    renderActivity(limit){
      var rows=this.state.activity.slice(0,limit||12);
      return rows.length?h('div',{className:'activity-list'},rows.map(function(item){var tone=toneForState(item.eventType);if(/failed|error|gap/i.test(item.eventType))tone='danger';else if(/completed|final|started|indexed/i.test(item.eventType))tone='success';return h('div',{key:item.id,className:'activity-row'},h('span',{className:'activity-dot '+tone}),h('div',{className:'activity-copy'},h('strong',null,eventLabel(item.eventType)),h('small',null,formatTime(item.occurredAt)+' · '+shortId(item.correlationId))),Object.keys(item.payload||{}).length?h('span',{className:'activity-payload'},Object.keys(item.payload).slice(0,2).map(function(key){return key+': '+text(item.payload[key]);}).join(' · ')):null);})) : h(Empty,{symbol:'A',title:'رویدادی ثبت نشده'});
    }

    renderSession(){
      return h('div',{className:'session-view focused-session'},
        this.renderSessionCommand(),
        this.renderSessionSummaryStrip(),
        h('div',{className:'focused-workspace'},
          h('div',{className:'focused-live-column'},this.renderTranscript(),h('div',{className:'conversation-launcher'},h('div',null,h('span',{className:'eyebrow'},'CONVERSATION HUB'),h('strong',null,'سؤال‌ها و پاسخ‌ها خارج از متن زنده نگه داشته می‌شوند.'),h('small',null,'پاسخ‌ها خودکار آماده می‌شوند؛ برای مرور همه Turnها پنجره مکالمات را باز کن.')),h(Button,{variant:'state',tone:'primary',disabled:!this.state.turns.length,onClick:this.openConversationHub.bind(this)},'باز کردن مکالمات · '+this.state.turns.length))),
          this.renderInspector()
        )
      );
    }

    renderSources(){
      return h('div',{className:'page-shell'},
        h('div',{className:'page-title'},h('div',null,h('span',{className:'eyebrow'},'SOURCE GROUNDING'),h('h1',null,'منابع و بازیابی'),h('p',null,'تمام فایل‌ها از یک مسیر FTS5 ایندکس می‌شوند و استنادها فقط از قطعه‌های بازیابی‌شده پذیرفته می‌شوند.')),h(Chip,{tone:'primary'},this.state.sources.length+' منبع')),
        h('div',{className:'sources-layout'},
          h(Surface,{className:'source-import'},h(SectionHead,{title:'افزودن منبع',subtitle:'TXT، Markdown، CSV، JSON یا متن خام'}),h(Field,{label:'عنوان'},h('input',{className:'modern-input',value:this.state.sourceTitle,onChange:function(event){this.setState({sourceTitle:event.target.value});}.bind(this)})),h(Field,{label:'فایل متنی'},h('input',{className:'modern-file',type:'file',accept:'.txt,.md,.markdown,.csv,.json,.log,text/plain',onChange:this.onSourceFile.bind(this)})),this.state.sourceFileName?h(Chip,{tone:'primary'},this.state.sourceFileName):null,h(Field,{label:'متن منبع'},h('textarea',{className:'modern-textarea source-area',value:this.state.sourceText,onChange:function(event){this.setState({sourceText:event.target.value});}.bind(this),placeholder:'متن منبع را وارد کن…'})),h(Button,{variant:'state',tone:'primary',loading:this.state.busySource,disabled:!this.state.sourceText.trim(),onClick:this.importSource.bind(this)},'ایندکس منبع')),
          h(Surface,{className:'sources-library'},h(SectionHead,{title:'منابع ایندکس‌شده',subtitle:'حذف هر منبع incremental است.',action:h(Chip,{tone:'neutral'},String(this.state.sources.length))}),h('div',{className:'sources-list'},this.state.sources.length?this.state.sources.map(function(source){return h('div',{key:source.id,className:'source-row'},h('div',{className:'source-icon'},'S'),h('div',{className:'source-copy'},h('strong',null,text(source.title)),h('small',null,text(source.chunk_count,0)+' قطعه · '+shortId(source.sha256))),h(Button,{variant:'icon',tone:'danger',title:'حذف منبع',onClick:function(){this.deleteSource(source.id);}.bind(this)},'حذف'));},this):h(Empty,{symbol:'S',title:'منبعی وجود ندارد',text:'یک فایل متنی یا متن خام اضافه کن.'}))),
          h(Surface,{className:'retrieval-surface'},h(SectionHead,{title:'آزمون بازیابی',subtitle:'نتایج واقعی index؛ مستقل از Brain'}),h('div',{className:'retrieval-input'},h('input',{className:'modern-input',value:this.state.retrieveQuery,onChange:function(event){this.setState({retrieveQuery:event.target.value});}.bind(this),placeholder:'عبارت موردنظر…'}),h(Button,{variant:'soft',tone:'primary',disabled:!this.state.retrieveQuery.trim(),onClick:this.retrieve.bind(this)},'جست‌وجو')),h('div',{className:'retrieval-results'},this.state.retrieveResults.map(function(item){return h('article',{key:item.chunkId,className:'retrieval-card'},h('div',{className:'retrieval-title'},text(item.title)+' · قطعه '+text(item.ordinal)),h('div',{className:'retrieval-excerpt'},text(item.excerpt,'')),h('small',null,'score '+text(item.score)));})))
        )
      );
    }

    renderSettings(){
      var asr=this.state.asr||{},brain=this.state.brainRuntime||{},ready=runtimeReady(asr)&&runtimeReady(brain),runtimeError=runtimeIssue(asr)||runtimeIssue(brain);
      var sessionCard=h(Surface,{className:'settings-card session-settings'},
        h(SectionHead,{eyebrow:'SESSION',title:'رفتار جلسه',subtitle:'این مقادیر برای جلسهٔ بعد و کانتکست فعلی استفاده می‌شوند.'}),
        h(Field,{label:'حالت پیش‌فرض'},
          h('select',{className:'modern-select',value:this.state.mode,disabled:this.state.sessionActive,onChange:function(event){this.changeMode(event.target.value);}.bind(this)},
            MODES.map(function(mode){return h('option',{key:mode.value,value:mode.value},mode.label+' · '+mode.short);})
          )
        ),
        h('div',{className:'settings-toggle-pair'},
          h(ToggleButton,{label:'میکروفون',active:this.state.mic,disabled:this.state.sessionActive,onClick:function(){this.changePreference('mic',!this.state.mic);}.bind(this)}),
          h(ToggleButton,{label:'صدای سیستم',active:this.state.loopback,disabled:this.state.sessionActive,onClick:function(){this.changePreference('loopback',!this.state.loopback);}.bind(this)})
        ),
        h(Field,{label:'اندازهٔ chunk خام',help:'ثبت صوت مستقل از ASR باقی می‌ماند.'},
          h('select',{className:'modern-select',value:String(this.state.chunkSeconds),disabled:this.state.sessionActive,onChange:function(event){this.changePreference('chunkSeconds',Number(event.target.value));}.bind(this)},
            [3,5,8,10].map(function(value){return h('option',{key:value,value:String(value)},value+' ثانیه');})
          )
        ),
        h(Field,{label:'سبک پاسخ'},
          h('select',{className:'modern-select',value:this.state.responseStyle,onChange:function(event){this.changePreference('responseStyle',event.target.value);}.bind(this)},
            h('option',{value:'concise'},'کوتاه و مستقیم'),
            h('option',{value:'balanced'},'متعادل'),
            h('option',{value:'detailed'},'تشریحی')
          )
        ),
        h(Field,{label:'کانتکست جلسه',help:'موضوع، نقش، سطح پاسخ و محدودیت‌ها؛ حداکثر ۱۲هزار نویسه.'},
          h('textarea',{className:'modern-textarea context-area',maxLength:12000,value:this.state.contextText,onChange:function(event){this.setState({contextText:event.target.value});}.bind(this),placeholder:'مثال: جلسهٔ آمار پیشرفته؛ پاسخ‌ها فارسی، دقیق و با تمرکز بر تعریف‌ها باشند.'})
        ),
        h('div',{className:'field-counter'},this.state.contextText.length+' / 12000'),
        h(Button,{variant:'state',tone:'primary',loading:this.state.busySettings,onClick:this.saveSessionSettings.bind(this)},this.state.sessionId?'ذخیره برای این جلسه':'ذخیرهٔ پیش‌فرض')
      );

      var aiCard=h(Surface,{className:'settings-card ai-settings'},
        h(SectionHead,{eyebrow:'AI RUNTIME',title:'ASR و Brain',subtitle:'کلید فقط در RAM این اجرای برنامه نگه داشته می‌شود.',action:h(Chip,{tone:ready?'success':'neutral'},ready?'فعال':'خاموش')}),
        h(Field,{label:'مدل Gemini'},
          h('input',{className:'modern-input ltr',value:this.state.model,onChange:function(event){this.setState({model:event.target.value});lsSet('model',event.target.value);}.bind(this),list:'model-options'})
        ),
        h('datalist',{id:'model-options'},h('option',{value:'gemini-3.1-flash-lite'}),h('option',{value:'gemini-3.1-flash'})),
        h(Field,{label:'Gemini API Key'},
          h('input',{className:'modern-input ltr',type:'password',value:this.state.apiKey,onChange:function(event){this.setState({apiKey:event.target.value});}.bind(this),placeholder:'AIza…',autoComplete:'off',spellCheck:false})
        ),
        h('div',{className:'security-note'},'این build از Gemini Audio به‌عنوان adapter اولیه استفاده می‌کند؛ ضبط صوت و ledger با قطع یا quota شدن مدل متوقف نمی‌شوند.'),
        h('div',{className:'setting-row'},
          h('div',null,h('strong',null,'Fallback محلی whisper.cpp'),h('span',null,'در خطای Cloud، فقط به سرویس loopback محلی سوییچ می‌کند.')),
          h('input',{type:'checkbox',className:'form-check-input switch-input',checked:this.state.localAsrEnabled,onChange:function(event){this.setState({localAsrEnabled:event.target.checked});}.bind(this)})
        ),
        h(Field,{label:'آدرس whisper.cpp',help:'فقط http://127.0.0.1، localhost یا ::1 پذیرفته می‌شود.'},
          h('input',{className:'modern-input ltr',value:this.state.localAsrUrl,onChange:function(event){this.setState({localAsrUrl:event.target.value});}.bind(this),placeholder:'http://127.0.0.1:8080'})
        ),
        h('div',{className:'settings-actions'},
          h(Button,{variant:'soft',tone:'neutral',loading:this.state.busyRuntime,onClick:this.saveLocalAsr.bind(this)},'ذخیره ASR محلی'),
          h(Button,{variant:'soft',tone:'neutral',loading:this.state.busyRuntime,onClick:this.probeLocalAsr.bind(this)},'تست whisper.cpp')
        ),
        runtimeError?h('div',{className:'runtime-settings-alert'},h('strong',null,'AI فعال نیست'),h('span',null,runtimeError)):null,
        h('div',{className:'setting-row'},
          h('div',null,h('strong',null,'اتکا به منابع'),h('span',null,'استناد خارج از قطعه‌های بازیابی‌شده رد می‌شود.')),
          h('input',{type:'checkbox',className:'form-check-input switch-input',checked:this.state.strictSource,onChange:function(event){this.changePreference('strictSource',event.target.checked);}.bind(this)})
        ),
        h('div',{className:'setting-row'},
          h('div',null,h('strong',null,'پاسخ خودکار'),h('span',null,'فقط Turnهای مجاز در سیاست Mode پاسخ می‌گیرند.')),
          h('input',{type:'checkbox',className:'form-check-input switch-input',checked:this.state.autoAnswer,onChange:function(event){this.changePreference('autoAnswer',event.target.checked);}.bind(this)})
        ),
        h('div',{className:'settings-actions'},
          h(Button,{variant:'state',tone:ready?'success':'primary',active:ready,loading:this.state.busyRuntime,onClick:this.quickSetup.bind(this)},ready?'AI فعال است':'فعال‌سازی AI'),
          h(Button,{variant:'soft',tone:'neutral',loading:this.state.busyRuntime,onClick:this.testBrain.bind(this)},'تست Brain')
        )
      );

      var appearanceCard=h(Surface,{className:'settings-card appearance-settings'},
        h(SectionHead,{eyebrow:'APPEARANCE',title:'ظاهر',subtitle:'پوسته فقط یک ترجیح محلی UI است.'}),
        h('div',{className:'theme-choice'},
          h('button',{type:'button',className:'theme-card'+(this.state.theme==='light'?' selected':''),onClick:function(){this.setTheme('light');}.bind(this)},h('div',{className:'theme-preview light-preview'},h('span'),h('i'),h('i')),h('strong',null,'روشن')),
          h('button',{type:'button',className:'theme-card'+(this.state.theme==='dark'?' selected':''),onClick:function(){this.setTheme('dark');}.bind(this)},h('div',{className:'theme-preview dark-preview'},h('span'),h('i'),h('i')),h('strong',null,'تیره'))
        ),
        h('div',{className:'design-rules'},
          h('div',null,h('strong',null,'وضعیت واقعی'),'رنگ فعال فقط از state واقعی backend می‌آید.'),
          h('div',null,h('strong',null,'خطای قابل اقدام'),'خطای provider از مسیر capture جدا نمایش داده می‌شود.'),
          h('div',null,h('strong',null,'جزئیات در محل درست'),'telemetry فنی در صفحهٔ سیستم باقی می‌ماند.')
        )
      );

      return h('div',{className:'page-shell settings-page'},
        h('div',{className:'page-title'},h('div',null,h('span',{className:'eyebrow'},'CONTROL CENTER'),h('h1',null,'تنظیمات'),h('p',null,'پیش‌فرض‌های جلسه، سرویس AI و ظاهر برنامه از هم جدا نگه داشته می‌شوند.')),h(Chip,{tone:ready?'success':'neutral',dot:true,active:ready},ready?'AI READY':'AI OFF')),
        h('div',{className:'settings-layout'},sessionCard,aiCard,appearanceCard)
      );
    }

    renderSystem(){
      var health=this.state.health||{},components=health.components||{},metrics=this.state.metrics||{},native=this.state.native||{},asr=this.state.asr||{};
      var activeCaps=health.capabilities||[],pendingCaps=health.nonCapabilities||[];
      return h('div',{className:'page-shell system-page'},
        h('div',{className:'page-title'},h('div',null,h('span',{className:'eyebrow'},'OBSERVABILITY'),h('h1',null,'وضعیت سیستم'),h('p',null,'سلامت هر جزء جداست؛ رسیدن frame به‌تنهایی به معنی سلامت ASR یا Brain نیست.')),h(Chip,{tone:toneForState(health.status),dot:true,active:health.status==='healthy'},text(health.status,'unknown').toUpperCase())),
        h('div',{className:'metric-grid'},h(Metric,{label:'جلسه‌ها',value:metrics.sessions||0}),h(Metric,{label:'Turnها',value:metrics.turns||0}),h(Metric,{label:'متن‌ها',value:metrics.transcripts||0}),h(Metric,{label:'قطعه‌های صوتی',value:metrics.audioChunks||0,note:formatBytes(metrics.audioBytes||0)}),h(Metric,{label:'Gapها',value:metrics.gaps||0,tone:Number(metrics.gaps)>0?'danger':''}),h(Metric,{label:'پاسخ‌ها',value:metrics.answers||0})),
        h('div',{className:'system-layout'},
          h(Surface,{className:'component-surface'},h(SectionHead,{title:'سلامت اجزا',subtitle:'State و engine واقعی گزارش‌شده از backend'}),h('div',{className:'component-grid'},Object.keys(components).map(function(key){var item=components[key]||{};return h('article',{key:key,className:'component-card'},h('div',{className:'component-card-top'},h('strong',null,key),h(Chip,{tone:toneForState(item.state)},text(item.state))),h('p',null,text(item.engine,'—')));}))),
          h(Surface,{className:'pipeline-diagnostics-surface'},h(SectionHead,{title:'چرخهٔ پردازش',subtitle:'این نمای فنی از Workspace اصلی حذف شده و فقط برای بررسی وضعیت اجزاست.'}),this.renderPipeline()),
          h(Surface,{className:'activity-surface'},h(SectionHead,{title:'فعالیت‌های اخیر',subtitle:'رویدادهای redacted جلسهٔ انتخاب‌شده'}),this.renderActivity(18)),
          h(Surface,{className:'capability-surface'},h(SectionHead,{title:'قابلیت‌های این build',subtitle:'قابلیت موجود از هدف معماری جدا نمایش داده می‌شود.'}),h('div',{className:'capability-columns'},h('div',null,h('h3',null,'موجود'),h('div',{className:'capability-list'},activeCaps.map(function(item){return h('span',{key:item,className:'capability-tag active'},text(item));}))),h('div',null,h('h3',null,'هنوز production-ready نیست'),h('div',{className:'capability-list'},pendingCaps.map(function(item){return h('span',{key:item,className:'capability-tag pending'},text(item));}))))),
          h(Surface,{className:'technical-surface'},h(SectionHead,{title:'جزئیات فنی',subtitle:'برای عیب‌یابی؛ بدون کلید و صوت خام'}),h('pre',{className:'diag-pre'},JSON.stringify({native:{state:native.state,channels:native.channels,gaps:native.gaps,queueDepth:native.queueDepth,queueCapacity:native.queueCapacity,analysis:native.analysis},asr:asr},null,2)),h('div',{className:'diag-actions'},h(Button,{variant:'soft',tone:'warning',disabled:!this.state.sessionId,onClick:this.retryFailed.bind(this)},'تلاش مجدد ASR'),h(Button,{variant:'soft',tone:'neutral',onClick:this.exportDiagnostics.bind(this)},'خروجی Diagnostics')))
        )
      );
    }

    renderNotice(){if(!this.state.notice)return null;return h('div',{className:'snackbar '+this.state.notice.tone,role:'status'},this.state.notice.text);}
    renderFooter(){return h('footer',{className:'app-footer'},h('span',null,'Auralis · Audio ledger first'),h('span',null,'Connection: '+this.state.connection+' · '+(this.state.lastSyncAt?formatTime(this.state.lastSyncAt):'—')),h('span',null,text(this.state.version)));}
    render(){
      var content=this.state.view==='session'?this.renderSession():this.state.view==='sources'?this.renderSources():this.state.view==='settings'?this.renderSettings():this.renderSystem();
      return h('div',{className:'auralis-app',dir:'rtl'},this.renderTop(),h('main',{className:'app-main'},content),this.renderNotice(),this.renderFooter(),this.renderOverlays());
    }
  }

  var rootNode=document.getElementById('root');
  var tree=h(ErrorBoundary,null,h(App));
  if(typeof ReactDOM.createRoot==='function')ReactDOM.createRoot(rootNode).render(tree);else ReactDOM.render(tree,rootNode);
})();
