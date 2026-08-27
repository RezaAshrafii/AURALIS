(function(){
  'use strict';
  var React=window.React;
  var ReactDOM=window.ReactDOM;
  var UI=window.AuralisUI;
  var h=UI.h,MODES=UI.MODES,NAV_ITEMS=UI.NAV_ITEMS;
  var Chip=UI.Chip,Button=UI.Button,ToggleButton=UI.ToggleButton,Surface=UI.Surface,Field=UI.Field,Empty=UI.Empty,SectionHead=UI.SectionHead,Metric=UI.Metric,PipelineStage=UI.PipelineStage,ErrorBoundary=UI.ErrorBoundary;
  var text=UI.text,formatTime=UI.formatTime,formatDate=UI.formatDate,formatDuration=UI.formatDuration,formatBytes=UI.formatBytes,shortId=UI.shortId,roleLabel=UI.roleLabel,modeMeta=UI.modeMeta,eventLabel=UI.eventLabel,toneForState=UI.toneForState,lsGet=UI.lsGet,lsSet=UI.lsSet;

  function isCaptureActive(value){return /CAPTURING|RUNNING/i.test(String(value||''));}
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
        token:'',version:'0.16.0',view:'dashboard',hubTab:'audio',theme:lsGet('theme','dark'),connection:'booting',
        health:null,metrics:null,native:null,asr:null,brainRuntime:null,
        sessions:[],sessionId:null,activeSessionId:null,sessionActive:false,currentSession:null,
        mode:lsGet('mode','oral_copilot'),mic:lsGet('mic',true),loopback:lsGet('loopback',true),chunkSeconds:Number(lsGet('chunkSeconds',5)),
        contextText:lsGet('contextText',''),responseStyle:lsGet('responseStyle','concise'),
        turns:[],transcripts:[],gaps:[],activity:[],selectedTurnId:null,selectedDetail:null,inspectorPinned:false,
        sources:[],retrieveResults:[],retrieveQuery:'',sourceTitle:'منبع جدید',sourceText:'',sourceFileName:'',
        apiKey:'',model:lsGet('model','gemini-3.1-flash-lite'),strictSource:lsGet('strictSource',true),autoAnswer:lsGet('autoAnswer',true),localAsrEnabled:lsGet('localAsrEnabled',false),localAsrUrl:lsGet('localAsrUrl','http://127.0.0.1:8080'),
        workspaces:[],currentWorkspaceId:lsGet('workspaceId','default-workspace'),projects:[],people:[],tasks:[],dashboard:null,currentInsights:[],
        memorySettings:null,memories:[],memoryReview:[],memoryContradictions:[],memoryBackfills:[],memoryDetail:null,memoryTab:'review',memoryQuery:'',memoryStatus:'',memoryEditText:'',memoryExport:null,memoryDeleteConfirm:false,
        newProjectName:'',newProjectDesc:'',newPersonName:'',newPersonRole:'',newPersonEmail:'',newTaskTitle:'',newTaskDeadline:'',
        manualText:'',busySession:false,busyRuntime:false,busyManual:false,busySource:false,busyAnswer:false,busySettings:false,busyUnderstanding:false,busyMemory:false,
        entityEditor:null,
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
      if(this.state.currentWorkspaceId)headers.set('x-auralis-workspace-id',this.state.currentWorkspaceId);
      if(options.body&&!headers.has('content-type'))headers.set('content-type','application/json');
      var res=await fetch(path,Object.assign({},options,{headers:headers}));
      var data={};
      try{data=await res.json();}catch(e){}
      if(!res.ok){
        var raw = data.message !== undefined ? data.message : (data.error && data.error.message ? data.error.message : (data.error !== undefined ? data.error : 'HTTP ' + res.status));
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
        this.setState({token:this.token,version:String(bootstrap.version||'0.16.0')});
        var sessionData=await this.refreshSessions();
        await Promise.all([this.refreshHealth(),this.refreshNative(),this.refreshRuntime(),this.refreshMetrics(),this.refreshSources(),this.refreshWorkspaces()]);
        var sessions=sessionData&&sessionData.sessions||[];
        var preferred=(sessionData&&sessionData.activeSessionId)||lsGet('lastSessionId',null)||(sessions[0]&&sessions[0].id);
        if(preferred&&sessions.some(function(item){return item.id===preferred;}))await this.openSession(preferred,true);
        this.setState({connection:'online',lastSyncAt:new Date().toISOString()});
        this.pollTimer=setInterval(function(){this.poll();}.bind(this),1000);
        this.metricsTimer=setInterval(function(){this.refreshMetrics();this.refreshWorkspaces();}.bind(this),5000);
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

    async refreshWorkspaces(){
      try{
        var wsRes=await this.api('/v1/workspaces');
        var workspaces=wsRes&&wsRes.workspaces||[];
        var wsId=this.state.currentWorkspaceId||'default-workspace';
        if(!workspaces.some(function(item){return item.id===wsId;}))wsId=(workspaces[0]&&workspaces[0].id)||'default-workspace';
        var results=await Promise.all([
          this.api('/v1/workspaces/'+wsId+'/dashboard'),
          this.api('/v1/workspaces/'+wsId+'/projects'),
          this.api('/v1/workspaces/'+wsId+'/people'),
          this.api('/v1/workspaces/'+wsId+'/tasks'),
          this.api('/v1/workspaces/'+wsId+'/memory-settings'),
          this.api('/v1/workspaces/'+wsId+'/memories?limit=100'),
          this.api('/v1/workspaces/'+wsId+'/memory-review?limit=100'),
          this.api('/v1/workspaces/'+wsId+'/memory-contradictions'),
          this.api('/v1/workspaces/'+wsId+'/memory-backfills')
        ]);
        lsSet('workspaceId',wsId);
        this.setState({
          workspaces:workspaces,
          currentWorkspaceId:wsId,
          dashboard:results[0]&&results[0].dashboard||null,
          projects:results[1]&&results[1].projects||[],
          people:results[2]&&results[2].people||[],
          tasks:results[3]&&results[3].tasks||[],
          memorySettings:results[4]&&results[4].settings||null,
          memories:results[5]&&results[5].memories||[],
          memoryReview:results[6]&&results[6].memories||[],
          memoryContradictions:results[7]&&results[7].contradictions||[],
          memoryBackfills:results[8]&&results[8].jobs||[]
        });
      }catch(e){this.setNotice('بارگذاری فضای کاری ناموفق بود: '+text(e&&e.message),'danger');}
    }

    changeWorkspace(workspaceId){
      lsSet('workspaceId',workspaceId);
      this.setState({currentWorkspaceId:workspaceId},this.refreshWorkspaces.bind(this));
    }

    async createWorkspaceProject(e){
      if(e)e.preventDefault();
      if(!this.state.newProjectName)return;
      try{
        var wsId=this.state.currentWorkspaceId||'default-workspace';
        await this.api('/v1/workspaces/'+wsId+'/projects',{
          method:'POST',
          body:JSON.stringify({name:this.state.newProjectName,description:this.state.newProjectDesc||''})
        });
        this.setState({newProjectName:'',newProjectDesc:''});
        this.setNotice('پروژه با موفقیت ایجاد شد','success');
        await this.refreshWorkspaces();
      }catch(err){this.setNotice(err.message||'خطا در ساخت پروژه','danger');}
    }

    async createWorkspacePerson(e){
      if(e)e.preventDefault();
      if(!this.state.newPersonName)return;
      try{
        var wsId=this.state.currentWorkspaceId||'default-workspace';
        await this.api('/v1/workspaces/'+wsId+'/people',{
          method:'POST',
          body:JSON.stringify({displayName:this.state.newPersonName,roleTitle:this.state.newPersonRole||'',email:this.state.newPersonEmail||''})
        });
        this.setState({newPersonName:'',newPersonRole:'',newPersonEmail:''});
        this.setNotice('عضو جدید به فضای کار اضافه شد','success');
        await this.refreshWorkspaces();
      }catch(err){this.setNotice(err.message||'خطا در ایجاد مخاطب','danger');}
    }

    async createWorkspaceTask(e){
      if(e)e.preventDefault();
      if(!this.state.newTaskTitle)return;
      try{
        var wsId=this.state.currentWorkspaceId||'default-workspace';
        await this.api('/v1/workspaces/'+wsId+'/tasks',{
          method:'POST',
          body:JSON.stringify({title:this.state.newTaskTitle,dueAtUtc:this.state.newTaskDeadline?new Date(this.state.newTaskDeadline+'T23:59:59').toISOString():null,dueOriginalText:this.state.newTaskDeadline||null})
        });
        this.setState({newTaskTitle:'',newTaskDeadline:''});
        this.setNotice('اقدام / تسک جدید ثبت شد','success');
        await this.refreshWorkspaces();
      }catch(err){this.setNotice(err.message||'خطا در ایجاد تسک','danger');}
    }

    async transitionTask(taskId,targetState){
      try{
        await this.api('/v1/tasks/'+taskId+'/transitions',{
          method:'POST',
          body:JSON.stringify({state:targetState})
        });
        this.setNotice('وضعیت تسک به '+targetState+' تغییر یافت','success');
        await this.refreshWorkspaces();
      }catch(err){this.setNotice(err.message||'تغییر وضعیت مجاز نیست','danger');}
    }

    openEntityEditor(type,item){
      var draft={};
      if(type==='project')draft={name:item.name||'',description:item.description||'',status:item.status||'ACTIVE'};
      if(type==='person')draft={displayName:item.displayName||'',roleTitle:item.roleTitle||'',email:item.email||'',notes:item.notes||''};
      if(type==='task')draft={title:item.title||'',description:item.description||'',priority:item.priority||'NONE',dueAtUtc:item.dueAtUtc?String(item.dueAtUtc).slice(0,10):''};
      if(type==='conversation')draft={title:item.title||'',goal:item.goal||'',projectId:item.project_id||item.projectId||''};
      this.setState({entityEditor:{type:type,item:item,draft:draft,deleteConfirm:false}});
    }
    setEntityDraft(field,value){var editor=this.state.entityEditor;if(!editor)return;this.setState({entityEditor:Object.assign({},editor,{draft:Object.assign({},editor.draft,{[field]:value})})});}
    closeEntityEditor(){this.setState({entityEditor:null});}
    requestEntityDelete(){var editor=this.state.entityEditor;if(editor)this.setState({entityEditor:Object.assign({},editor,{deleteConfirm:true})});}

    async saveEntityEditor(e){
      if(e)e.preventDefault();var editor=this.state.entityEditor;if(!editor)return;
      var item=editor.item,draft=editor.draft,path='',body={revision:item.revision};
      if(editor.type==='project'){path='/v1/projects/'+item.id;body=Object.assign(body,{name:draft.name,description:draft.description,status:draft.status});}
      if(editor.type==='person'){path='/v1/people/'+item.id;body=Object.assign(body,{displayName:draft.displayName,roleTitle:draft.roleTitle,email:draft.email,notes:draft.notes});}
      if(editor.type==='task'){path='/v1/tasks/'+item.id;body=Object.assign(body,{title:draft.title,description:draft.description,priority:draft.priority,dueAtUtc:draft.dueAtUtc?new Date(draft.dueAtUtc+'T23:59:59').toISOString():null,dueOriginalText:draft.dueAtUtc||null});}
      if(editor.type==='conversation'){path='/v1/conversations/'+item.id;body=Object.assign(body,{title:draft.title,goal:draft.goal,projectId:draft.projectId||null});}
      try{await this.api(path,{method:'PATCH',body:JSON.stringify(body)});this.setState({entityEditor:null});await this.refreshWorkspaces();this.setNotice('تغییرات ذخیره شد.','success');}
      catch(error){this.setNotice('ذخیره ناموفق بود: '+error.message,'danger');}
    }

    async deleteEntityEditor(){
      var editor=this.state.entityEditor;if(!editor)return;var item=editor.item,path='';
      if(editor.type==='project')path='/v1/projects/'+item.id;
      if(editor.type==='person')path='/v1/people/'+item.id;
      if(editor.type==='task')path='/v1/tasks/'+item.id;
      if(editor.type==='conversation')path='/v1/conversations/'+item.id;
      try{await this.api(path+'?revision='+encodeURIComponent(item.revision),{method:'DELETE'});this.setState({entityEditor:null});await this.refreshWorkspaces();this.setNotice('مورد انتخاب‌شده از فضای فعال حذف و به سابقه منتقل شد.','success');}
      catch(error){this.setNotice('حذف ناموفق بود: '+error.message,'danger');}
    }

    async configureMemory(updates){
      var settings=this.state.memorySettings||{};this.setState({busyMemory:true});
      try{var data=await this.api('/v1/workspaces/'+this.state.currentWorkspaceId+'/memory-settings',{method:'PATCH',body:JSON.stringify(Object.assign({revision:settings.revision},updates))});this.setState({memorySettings:data.settings});await this.refreshWorkspaces();this.setNotice(data.settings.enabled?'حافظه با رضایت شما فعال شد.':'استفاده از حافظه فوراً خاموش شد؛ داده‌ها تا حذف شما حفظ می‌شوند.','success');}
      catch(error){this.setNotice('تنظیم حافظه ناموفق بود: '+error.message,'danger');}
      finally{this.setState({busyMemory:false});}
    }
    async extractMemories(){
      if(!this.state.sessionId){this.setNotice('ابتدا یک مکالمه را انتخاب کن.','warning');return;}
      this.setState({busyMemory:true});
      try{var data=await this.api('/v1/conversations/conv-'+this.state.sessionId+'/memory-extractions',{method:'POST',body:JSON.stringify({manual:true})});await this.refreshWorkspaces();this.setNotice((data.candidates||[]).length+' پیشنهاد حافظه ساخته شد.','success');}
      catch(error){this.setNotice('استخراج حافظه ناموفق بود: '+error.message,'danger');}
      finally{this.setState({busyMemory:false});}
    }
    async startMemoryBackfill(){
      this.setState({busyMemory:true});
      try{await this.api('/v1/workspaces/'+this.state.currentWorkspaceId+'/memory-backfills',{method:'POST',body:JSON.stringify({batchSize:5})});await this.refreshWorkspaces();this.setNotice('Backfill در صف محدود و قابل توقف آغاز شد.','success');}
      catch(error){this.setNotice('شروع Backfill ناموفق بود: '+error.message,'danger');}
      finally{this.setState({busyMemory:false});}
    }
    async controlMemoryBackfill(id,command){
      try{await this.api('/v1/memory-backfills/'+id+'/'+command,{method:'POST',body:'{}'});await this.refreshWorkspaces();this.setNotice('وضعیت Backfill به‌روز شد.','success');}
      catch(error){this.setNotice('کنترل Backfill ناموفق بود: '+error.message,'danger');}
    }
    async openMemoryDetail(id){try{var data=await this.api('/v1/memories/'+id);this.setState({memoryDetail:data.memory,memoryEditText:data.memory.content||'',memoryDeleteConfirm:false});}catch(error){this.setNotice(error.message,'danger');}}
    closeMemoryDetail(){this.setState({memoryDetail:null,memoryEditText:'',memoryDeleteConfirm:false});}
    async memoryCommand(id,command){this.setState({busyMemory:true});try{await this.api('/v1/memories/'+id+'/'+command,{method:'POST',body:'{}'});this.setState({memoryDetail:null});await this.refreshWorkspaces();this.setNotice(command==='confirm'?'حافظه تأیید شد.':'پیشنهاد حافظه رد شد.','success');}catch(error){this.setNotice(error.message,'danger');}finally{this.setState({busyMemory:false});}}
    async saveMemoryEdit(){var item=this.state.memoryDetail;if(!item)return;this.setState({busyMemory:true});try{var data=await this.api('/v1/memories/'+item.id,{method:'PATCH',body:JSON.stringify({content:this.state.memoryEditText,revision:item.revision})});this.setState({memoryDetail:data.memory,memoryEditText:data.memory.content});await this.refreshWorkspaces();this.setNotice('Revision جدید حافظه ذخیره شد و شواهد قبلی حفظ شدند.','success');}catch(error){this.setNotice(error.message,'danger');}finally{this.setState({busyMemory:false});}}
    async deleteMemory(id){this.setState({busyMemory:true});try{await this.api('/v1/memories/'+id,{method:'DELETE'});this.setState({memoryDetail:null,memoryDeleteConfirm:false});await this.refreshWorkspaces();this.setNotice('حافظه فوراً از retrieval خارج و purge تکمیل شد.','success');}catch(error){this.setNotice(error.message,'danger');}finally{this.setState({busyMemory:false});}}
    async resolveMemoryContradiction(id,resolution){try{await this.api('/v1/memory-contradictions/'+id+'/resolve',{method:'POST',body:JSON.stringify({resolution:resolution})});await this.refreshWorkspaces();this.setNotice('تناقض بدون حذف تاریخچه حل شد.','success');}catch(error){this.setNotice(error.message,'danger');}}
    async exportMemories(){
      try{var data=await this.api('/v1/workspaces/'+this.state.currentWorkspaceId+'/memory-exports',{method:'POST',body:JSON.stringify({format:'BOTH'})});var out=data.export||{};this.setState({memoryExport:out});if(out.json){var blob=new Blob([JSON.stringify(out.json,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='auralis-memory-export-v1.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}this.setNotice('خروجی versioned آماده شد.','success');}catch(error){this.setNotice(error.message,'danger');}
    }

    async confirmInsight(insightId){
      try{
        await this.api('/v1/insights/'+insightId+'/confirm',{method:'POST'});
        this.setNotice('نکته/تصمیم با موفقیت تایید و تثبیت شد','success');
        await Promise.all([this.refreshWorkspaces(),this.refreshUnderstanding()]);
      }catch(err){this.setNotice(err.message||'خطا در تایید insight','danger');}
    }

    async dismissInsight(insightId){
      try{
        await this.api('/v1/insights/'+insightId+'/dismiss',{method:'POST'});
        await this.refreshUnderstanding();
        this.setNotice('پیشنهاد رد شد.','neutral');
      }catch(err){this.setNotice(err.message||'خطا در رد insight','danger');}
    }

    async refreshUnderstanding(){
      if(!this.state.sessionId){this.setState({currentInsights:[]});return null;}
      try{
        var data=await this.api('/v1/conversations/conv-'+this.state.sessionId+'/understanding');
        this.setState({currentInsights:data.insights||[]});
        return data;
      }catch(error){this.setState({currentInsights:[]});return null;}
    }

    async runUnderstanding(){
      if(!this.state.sessionId){this.setNotice('ابتدا یک جلسه را انتخاب کن.','warning');return;}
      this.setState({busyUnderstanding:true});
      try{
        await this.api('/v1/conversations/conv-'+this.state.sessionId+'/understanding-runs',{method:'POST',body:JSON.stringify({})});
        await Promise.all([this.refreshUnderstanding(),this.refreshWorkspaces()]);
        this.setNotice('استخراج تصمیم‌ها، نکته‌ها و اقدام‌ها کامل شد.','success');
      }catch(error){this.setNotice('استخراج درک جلسه ناموفق بود: '+error.message,'danger');}
      finally{this.setState({busyUnderstanding:false});}
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
          h('div',{className:'manual-composer'},h('textarea',{value:this.state.manualText,disabled:!this.state.sessionActive,onChange:function(event){this.setState({manualText:event.target.value});}.bind(this),placeholder:this.state.sessionActive?'سؤال یا درخواست خود را بنویس…':'ابتدا جلسه را شروع کن…'}),h('div',{className:'composer-actions'},h(Button,{variant:'soft',tone:'neutral',disabled:!this.state.sessionActive||!this.state.manualText.trim()||this.state.busyManual,onClick:function(){this.submitManual(false);}.bind(this)},'فقط ثبت'),h(Button,{variant:'soft',tone:'primary',loading:this.state.busyManual,disabled:!this.state.sessionActive||!this.state.manualText.trim(),onClick:function(){this.submitManual(true);}.bind(this)},'ثبت و پاسخ'))),
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

    renderEntityEditor(){
      var editor=this.state.entityEditor;if(!editor)return null;var d=editor.draft,type=editor.type;
      var fields=[];
      if(type==='project')fields=[h(Field,{key:'name',label:'نام پروژه'},h('input',{className:'modern-input',value:d.name,onChange:function(e){this.setEntityDraft('name',e.target.value);}.bind(this)})),h(Field,{key:'desc',label:'توضیحات'},h('textarea',{className:'modern-textarea',value:d.description,onChange:function(e){this.setEntityDraft('description',e.target.value);}.bind(this)})),h(Field,{key:'status',label:'وضعیت'},h('select',{className:'modern-select',value:d.status,onChange:function(e){this.setEntityDraft('status',e.target.value);}.bind(this)},h('option',{value:'ACTIVE'},'فعال'),h('option',{value:'ON_HOLD'},'متوقف'),h('option',{value:'COMPLETED'},'تکمیل‌شده')) )];
      if(type==='person')fields=[h(Field,{key:'name',label:'نام'},h('input',{className:'modern-input',value:d.displayName,onChange:function(e){this.setEntityDraft('displayName',e.target.value);}.bind(this)})),h(Field,{key:'role',label:'سمت'},h('input',{className:'modern-input',value:d.roleTitle,onChange:function(e){this.setEntityDraft('roleTitle',e.target.value);}.bind(this)})),h(Field,{key:'email',label:'ایمیل'},h('input',{className:'modern-input ltr',value:d.email,onChange:function(e){this.setEntityDraft('email',e.target.value);}.bind(this)})),h(Field,{key:'notes',label:'یادداشت'},h('textarea',{className:'modern-textarea',value:d.notes,onChange:function(e){this.setEntityDraft('notes',e.target.value);}.bind(this)}))];
      if(type==='task')fields=[h(Field,{key:'title',label:'عنوان'},h('input',{className:'modern-input',value:d.title,onChange:function(e){this.setEntityDraft('title',e.target.value);}.bind(this)})),h(Field,{key:'description',label:'توضیحات'},h('textarea',{className:'modern-textarea',value:d.description,onChange:function(e){this.setEntityDraft('description',e.target.value);}.bind(this)})),h(Field,{key:'priority',label:'اولویت'},h('select',{className:'modern-select',value:d.priority,onChange:function(e){this.setEntityDraft('priority',e.target.value);}.bind(this)},['NONE','LOW','MEDIUM','HIGH'].map(function(x){return h('option',{key:x,value:x},x);}))),h(Field,{key:'due',label:'مهلت'},h('input',{className:'modern-input ltr',type:'date',value:d.dueAtUtc,onChange:function(e){this.setEntityDraft('dueAtUtc',e.target.value);}.bind(this)}))];
      if(type==='conversation')fields=[h(Field,{key:'title',label:'عنوان مکالمه'},h('input',{className:'modern-input',value:d.title,onChange:function(e){this.setEntityDraft('title',e.target.value);}.bind(this)})),h(Field,{key:'goal',label:'هدف'},h('textarea',{className:'modern-textarea',value:d.goal,onChange:function(e){this.setEntityDraft('goal',e.target.value);}.bind(this)})),h(Field,{key:'project',label:'پروژه'},h('select',{className:'modern-select',value:d.projectId,onChange:function(e){this.setEntityDraft('projectId',e.target.value);}.bind(this)},h('option',{value:''},'بدون پروژه'),this.state.projects.map(function(p){return h('option',{key:p.id,value:p.id},p.name);})))];
      return h('div',{className:'overlay-shell',onMouseDown:function(e){if(e.target===e.currentTarget)this.closeEntityEditor();}.bind(this)},h('section',{className:'modal-panel entity-editor',role:'dialog','aria-modal':'true','aria-label':'ویرایش موجودیت'},h('header',{className:'modal-head'},h('div',null,h('span',{className:'eyebrow'},'EDIT & DELETE'),h('h2',null,'ویرایش '+({project:'پروژه',person:'فرد',task:'تسک',conversation:'مکالمه'}[type]||'')),h('p',null,'حذف به‌صورت archive/tombstone انجام می‌شود تا provenance و ledger ناخواسته از بین نروند.')),h(Button,{variant:'icon',tone:'neutral',onClick:this.closeEntityEditor.bind(this)},'×')),h('form',{className:'entity-editor-form',onSubmit:this.saveEntityEditor.bind(this)},fields,h('div',{className:'editor-actions'},h(Button,{type:'submit',variant:'solid',tone:'primary'},'ذخیره تغییرات'),h(Button,{type:'button',variant:'soft',tone:'danger',onClick:this.requestEntityDelete.bind(this)},'حذف'))),editor.deleteConfirm?h('div',{className:'delete-confirm'},h('strong',null,'حذف این مورد تأیید شود؟'),h('p',null,'این مورد فوراً از فهرست فعال خارج می‌شود؛ داده‌های تاریخی وابسته حفظ می‌شوند.'),h('div',{className:'editor-actions'},h(Button,{variant:'solid',tone:'danger',onClick:this.deleteEntityEditor.bind(this)},'بله، حذف شود'),h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.setState({entityEditor:Object.assign({},editor,{deleteConfirm:false})});}.bind(this)},'انصراف'))):null));
    }

    renderMemoryDetail(){
      var item=this.state.memoryDetail;if(!item)return null;var revisions=item.revisions||[],usage=item.usage||[];
      return h('div',{className:'overlay-shell drawer-overlay',onMouseDown:function(e){if(e.target===e.currentTarget)this.closeMemoryDetail();}.bind(this)},h('aside',{className:'sessions-drawer memory-detail',role:'dialog','aria-modal':'true','aria-label':'جزئیات حافظه'},h('header',{className:'drawer-head'},h('div',null,h('span',{className:'eyebrow'},'MEMORY DETAIL'),h('h2',null,item.canonicalKey),h('p',null,item.scopeType+' · '+item.memoryType+' · '+item.status)),h(Button,{variant:'icon',tone:'neutral',onClick:this.closeMemoryDetail.bind(this)},'×')),h('div',{className:'memory-detail-body'},h(Field,{label:'محتوا'},h('textarea',{className:'modern-textarea',value:this.state.memoryEditText,onChange:function(e){this.setState({memoryEditText:e.target.value});}.bind(this)})),h('div',{className:'editor-actions'},h(Button,{variant:'solid',tone:'primary',loading:this.state.busyMemory,onClick:this.saveMemoryEdit.bind(this)},'ذخیره Revision جدید'),item.status==='CANDIDATE'?h(Button,{variant:'soft',tone:'success',onClick:function(){this.memoryCommand(item.id,'confirm');}.bind(this)},'تأیید'):null,h(Button,{variant:'soft',tone:'danger',onClick:function(){this.setState({memoryDeleteConfirm:true});}.bind(this)},'حذف و Purge')),this.state.memoryDeleteConfirm?h('div',{className:'delete-confirm'},h('strong',null,'حذف دائمی این حافظه تأیید شود؟'),h('p',null,'این عملیات دادهٔ حافظه را فوراً از retrieval خارج و محتوای آن را purge می‌کند.'),h('div',{className:'editor-actions'},h(Button,{variant:'solid',tone:'danger',onClick:function(){this.deleteMemory(item.id);}.bind(this)},'بله، حذف و Purge شود'),h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.setState({memoryDeleteConfirm:false});}.bind(this)},'انصراف'))):null,h(SectionHead,{eyebrow:'PROVENANCE',title:'Revisionها و شواهد',level:'h3'}),revisions.map(function(rev){return h('article',{key:rev.id,className:'memory-revision-card'},h('div',{className:'memory-card-head'},h('strong',null,'Revision '+rev.revision),h(Chip,{tone:'neutral'},rev.reason)),h('p',null,rev.content),rev.evidence.map(function(ev){return h('blockquote',{key:ev.id,className:'memory-evidence'},ev.evidenceType==='USER_EDIT'?'ویرایش مستقیم کاربر':'«'+ev.exactQuote+'» · Turn '+shortId(ev.turnId));}));}),h(SectionHead,{eyebrow:'USAGE',title:'تاریخچهٔ استفاده',level:'h3'}),usage.length?usage.map(function(row){return h('div',{key:row.id,className:'memory-usage-row'},h(Chip,{tone:'primary'},row.purpose),h('span',null,'رتبه '+text(row.rank,'—')+' · امتیاز '+text(row.score,'—')),h('small',null,formatDate(row.createdAt)));}):h('p',{className:'muted-copy'},'هنوز در پاسخی استفاده نشده است.'))));
    }

    renderOverlays(){return h(React.Fragment,null,this.renderConversationHub(),this.renderSessionsDrawer(),this.renderTranscriptArchive(),this.renderEntityEditor(),this.renderMemoryDetail());}

    renderTop(){
      var healthStatus=text(this.state.health&&this.state.health.status,'connecting').toUpperCase();
      var healthTone=toneForState(healthStatus);
      return h('header',{className:'appbar'},
        h('div',{className:'brand-block'},h('div',{className:'brand-mark','aria-hidden':'true'},h('span',{className:'brand-wave'},h('i'),h('i'),h('i'),h('i'))),h('div',null,h('div',{className:'brand-line'},h('span',{className:'brand-name'},'Auralis'),h('span',{className:'brand-edition'},'Direct Audio Workspace')),h('div',{className:'brand-version'},'v0.16.0 · Personal Memory Engine'))),
        h('nav',{className:'top-nav','aria-label':'بخش‌های برنامه'},NAV_ITEMS.map(function(item){
          var active=this.state.view===item.value;
          return h('button',{key:item.value,type:'button',className:'nav-item'+(active?' active':''),onClick:function(){this.setState({view:item.value});}.bind(this),'aria-current':active?'page':undefined},h('span',null,item.label),h('small',null,item.caption));
        },this)),
        h('div',{className:'top-actions'},this.state.workspaces.length>1?h('select',{className:'workspace-switcher','aria-label':'انتخاب فضای کاری',value:this.state.currentWorkspaceId,onChange:function(event){this.changeWorkspace(event.target.value);}.bind(this)},this.state.workspaces.map(function(item){return h('option',{key:item.id,value:item.id},item.name);})):null,h(Chip,{tone:healthTone,dot:true,active:healthTone==='success'},healthStatus),this.state.sessionActive?h(Chip,{tone:'primary',dot:true,active:true},'جلسه فعال'):h(Chip,{tone:'neutral'},'آماده'),h(Button,{variant:'soft',tone:'neutral',className:'top-history-btn',onClick:this.openSessionsDrawer.bind(this),title:'جلسات اخیر'},'جلسات'),h(Button,{variant:'icon',tone:'neutral',onClick:function(){this.setTheme(this.state.theme==='dark'?'light':'dark');}.bind(this),title:'تغییر پوسته'},this.state.theme==='dark'?'روز':'شب'))
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
      var answer=detail.latestAnswer,answerable=['question','request'].indexOf(detail.turn.kind)>=0,retrieved=answer&&answer.retrieved||[],citations=answer&&answer.citations||[],usedMemories=answer&&answer.memoryContext||[],cited=new Set(answer&&answer.sourceChunkIds||[]),intelligence=detail.intelligence;
      return h(Surface,{className:'inspector-surface'},
        h(SectionHead,{eyebrow:'TURN INSPECTOR',title:'جزئیات پاسخ',action:h('div',{className:'inspector-head-actions'},h(Chip,{tone:detail.turn.source_role==='system'?'purple':'blue'},roleLabel(detail.turn.source_role)),this.state.inspectorPinned?h(Button,{variant:'soft',tone:'neutral',className:'follow-live-btn',onClick:this.followLive.bind(this)},'دنبال‌کردن زنده'):h(Chip,{tone:'success',dot:true,active:true},'LIVE'))}),
        h('div',{className:'inspector-question'},h('span',{className:'mini-caption'},'پرسش / درخواست'),h('div',{className:'big-copy'},text(detail.turn.text_raw,'')),h('div',{className:'route-meta'},h(Chip,{tone:answerable?'primary':'neutral'},text(detail.turn.kind)),h('span',null,text(detail.turn.route_reason)) )),
        intelligence?h('div',{className:'intelligence-strip'},h(Chip,{tone:intelligence.ambiguous?'danger':'primary'},text(intelligence.intent,'unknown')),h('span',null,'اطمینان '+Math.round(Number(intelligence.confidence||0)*100)+'٪'),intelligence.continuation?h(Chip,{tone:'purple'},'ادامهٔ Turn '+shortId(intelligence.parentTurnId)):null,(intelligence.topicTerms||[]).slice(0,3).map(function(term){return h(Chip,{key:term,tone:'neutral'},text(term));})):null,
        h('div',{className:'inspector-answer'},h('span',{className:'mini-caption'},'پاسخ'),answer?h('div',{className:'answer-copy'},text(answer.answer)):h('div',{className:'answer-placeholder'},answerable?'هنوز پاسخی ثبت نشده است.':'این Turn خبری است و به Brain ارسال نمی‌شود.')),
        answerable&&!answer?h('div',{className:'answer-waiting'},h('span',null,shouldAutoAnswerUi(detail.turn,(this.state.currentSession&&this.state.currentSession.mode)||this.state.mode,this.state.autoAnswer,this.state.loopback)?'پاسخ خودکار در حال آماده‌سازی است.':'این Mode پاسخ خودکار این Turn را تولید نمی‌کند.'),h('kbd',null,'Z'),h('small',null,'پاسخ دستی / فوری')):null,
        answer?h('div',{className:'answer-foot'},h(Chip,{tone:answer.grounding==='source'?'success':answer.grounding==='grounding_unverified'?'danger':'neutral'},text(answer.grounding)),h('span',null,(answer.sourceChunkIds||[]).length+' استناد معتبر'),h('span',null,text(answer.model))):null,
        citations.length?h('div',{className:'citation-list'},citations.map(function(item,index){return h('blockquote',{key:item.chunkId,className:'citation-quote'},h('strong',null,'['+(index+1)+'] '+text(item.title,'منبع')),h('span',null,'«'+text(item.quote,'بدون نقل‌قول')+'»'));})):null,
        usedMemories.length?h('details',{className:'memory-transparency',open:true},h('summary',null,'حافظه‌های استفاده‌شده · '+usedMemories.length),h('p',{className:'muted-copy'},'این موارد فقط داده‌اند، نه دستور؛ استفادهٔ هر مورد در audit ثبت شده است.'),usedMemories.map(function(item){return h('article',{key:item.id,className:'used-memory-card'},h('div',null,h('strong',null,item.content),h('small',null,item.scopeType+':'+shortId(item.scopeId)+' · relevance '+text(item.score))),h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openMemoryDetail(item.id);}.bind(this)},'مشاهده / اصلاح / حذف'));},this)):null,
        retrieved.length?h('details',{className:'sources-disclosure'},h('summary',null,'شواهد بازیابی‌شده'),h('div',{className:'evidence-list'},retrieved.map(function(item){return h('article',{key:item.chunkId,className:'evidence-card'+(cited.has(item.chunkId)?' cited':'')},h('div',{className:'evidence-title'},text(item.title,'منبع')),h('div',{className:'evidence-text'},text(item.excerpt,'')));}))):null,
        detail.segments&&detail.segments.length?h('details',{className:'technical-disclosure'},h('summary',null,'اتصال فنی Turn به صوت'),h('pre',null,detail.segments.map(function(segment){return 'segment '+shortId(segment.id)+'\nASR '+text(segment.transcript_provider)+' / '+text(segment.transcript_model)+'\nrevision '+text(segment.transcript_revision)+'\nseq '+text(segment.seq_start)+'..'+text(segment.seq_end);}).join('\n\n'))):null
      );
    }

    renderActivity(limit){
      var rows=this.state.activity.slice(0,limit||12);
      return rows.length?h('div',{className:'activity-list'},rows.map(function(item){var tone=toneForState(item.eventType);if(/failed|error|gap/i.test(item.eventType))tone='danger';else if(/completed|final|started|indexed/i.test(item.eventType))tone='success';return h('div',{key:item.id,className:'activity-row'},h('span',{className:'activity-dot '+tone}),h('div',{className:'activity-copy'},h('strong',null,eventLabel(item.eventType)),h('small',null,formatTime(item.occurredAt)+' · '+shortId(item.correlationId))),Object.keys(item.payload||{}).length?h('span',{className:'activity-payload'},Object.keys(item.payload).slice(0,2).map(function(key){return key+': '+text(item.payload[key]);}).join(' · ')):null);})) : h(Empty,{symbol:'A',title:'رویدادی ثبت نشده'});
    }

    renderSession(){
      var tab = this.state.hubTab || 'audio';
      var insights=this.state.currentInsights||[];

      return h('div',{className:'session-view focused-session','data-product-view':'conversation-hub'},
        h('div',{className:'page-title',style:{display:'flex',justifyContent:'space-between'}},
          h('div',null,h('span',{className:'eyebrow'},'CONVERSATION HUB'),h('h1',null,'مرکز مکالمات'),h('p',null,'مدیریت صوت، متن و خروجی‌های هوشمند جلسه.')),
          h('div',{style:{display:'flex',gap:'8px'}},
            h(Button,{variant:tab==='audio'?'solid':'soft',tone:tab==='audio'?'primary':'neutral',onClick:function(){this.setState({hubTab:'audio'});}.bind(this)},'Audio'),
            h(Button,{variant:tab==='transcript'?'solid':'soft',tone:tab==='transcript'?'primary':'neutral',onClick:function(){this.setState({hubTab:'transcript'});}.bind(this)},'Transcript'),
            h(Button,{variant:tab==='understanding'?'solid':'soft',tone:tab==='understanding'?'primary':'neutral',onClick:function(){this.setState({hubTab:'understanding'});this.refreshUnderstanding();}.bind(this)},'Understanding')
          )
        ),
        tab === 'audio' ? h('div', {className:'tab-content audio-tab'},
          this.renderSessionCommand(),
          this.renderSessionSummaryStrip()
        ) : tab === 'transcript' ? h('div', {className:'tab-content transcript-tab'},
          h('div',{className:'focused-workspace'},
            h('div',{className:'focused-live-column'},this.renderTranscript(),h('div',{className:'conversation-launcher'},h('div',null,h('span',{className:'eyebrow'},'CONVERSATION HUB'),h('strong',null,'سؤال‌ها و پاسخ‌ها خارج از متن زنده نگه داشته می‌شوند.'),h('small',null,'پاسخ‌ها خودکار آماده می‌شوند؛ برای مرور همه Turnها پنجره مکالمات را باز کن.')),h(Button,{variant:'state',tone:'primary',onClick:this.openConversationHub.bind(this)},'باز کردن مکالمات · '+this.state.turns.length))),
            this.renderInspector()
          )
        ) : h('div', {className:'tab-content understanding-tab'},
          h(Surface, null,
            h(SectionHead,{eyebrow:'INSIGHTS',title:'خروجی‌های استخراج‌شده',level:'h3',action:h(Button,{variant:'soft',tone:'primary',loading:this.state.busyUnderstanding,disabled:!this.state.sessionId,onClick:this.runUnderstanding.bind(this)},'استخراج / به‌روزرسانی')}),
            insights.length?h('div',{className:'list-group'},insights.map(function(item){
              return h('div',{key:item.id,className:'list-item',style:{padding:'12px',borderBottom:'1px solid var(--border-soft)'}},
                h('div',{style:{display:'flex',justifyContent:'space-between',gap:'8px'}},h('strong',null,text(item.title,'بدون عنوان')),h(Chip,{tone:'primary'},item.type||item.status)),
                h('p',{style:{fontSize:'12px',marginTop:'4px'}},text(item.body)),
                h('div',{style:{display:'flex',gap:'6px',marginTop:'8px'}},h(Chip,{tone:item.status==='CONFIRMED'?'success':'neutral'},item.status),item.status==='SUGGESTED'?h(React.Fragment,null,h(Button,{variant:'soft',tone:'success',onClick:function(){this.confirmInsight(item.id);}.bind(this)},'تأیید'),h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.dismissInsight(item.id);}.bind(this)},'رد')):null)
              );
            },this)):h('p',{style:{color:'var(--text-soft)'}},'هنوز خروجی استخراج‌شده‌ای برای این جلسه وجود ندارد.')
          )
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

    renderDashboard(){
      var dash=this.state.dashboard||{};
      var totalConv=dash.totalConversations||0;
      var activeProj=dash.activeProjects||0;
      var openTasks=dash.openTasks||0;
      var recentDecisions=dash.recentDecisionsCount||0;
      var recentConvs=dash.recentConversations||[];
      var upTasks=dash.upcomingTasks||[];
      var decs=dash.recentDecisions||[];

      if(!totalConv && !activeProj && !openTasks) {
        return h('div',{className:'page-shell dashboard-page'},
          h('div',{className:'page-title'},
            h('div',null,h('span',{className:'eyebrow'},'WORKSPACE DASHBOARD'),h('h1',null,'داشبورد هوشمند'),h('p',null,'نمایی کلی از وضعیت فضای کاری شما.'))
          ),
          h(Empty,{symbol:'✦',title:'هنوز داده‌ای ثبت نشده است',text:'فضای کاری خود را با ثبت اولین جلسه یا اقدام آغاز کنید.'})
        );
      }

      return h('div',{className:'page-shell dashboard-page'},
        h('div',{className:'page-title'},
          h('div',null,h('span',{className:'eyebrow'},'WORKSPACE DASHBOARD'),h('h1',null,'داشبورد هوشمند'),h('p',null,'نمایی کلی از وضعیت فضای کاری شما.'))
        ),
        h('div',{className:'metrics-grid',style:{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:'16px',marginBottom:'24px'}},
          h(Metric,{label:'کل مکالمات',value:totalConv}),
          h(Metric,{label:'پروژه‌های فعال',value:activeProj}),
          h(Metric,{label:'اقدامات باز',value:openTasks}),
          h(Metric,{label:'تصمیمات اخیر',value:recentDecisions})
        ),
        h('div',{className:'dashboard-sections',style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'24px'}},
          h(Surface,null,
            h(SectionHead,{eyebrow:'RECENT',title:'مکالمات اخیر',level:'h3'}),
            recentConvs.length?h('div',{className:'list-group'},recentConvs.map(function(c){
              return h('div',{key:c.id,className:'list-item',style:{padding:'12px',borderBottom:'1px solid var(--border-soft)',cursor:'pointer'},onClick:function(){
                var sessionId=c.capture_session_id||c.id.replace(/^conv-/, '');
                this.setState({view:'session',sessionId:sessionId});
                this.openSession(sessionId);
              }.bind(this)},
                h('div',{style:{display:'flex',justifyContent:'space-between',gap:'8px'}},h('strong',null,text(c.title,'بدون عنوان')),h(Button,{variant:'soft',tone:'neutral',onClick:function(e){e.stopPropagation();this.openEntityEditor('conversation',c);}.bind(this)},'ویرایش / حذف')),
                h('div',{style:{fontSize:'11px',color:'var(--text-soft)',marginTop:'4px'}},formatDate(c.started_at))
              );
            }.bind(this))):h('p',{style:{color:'var(--text-soft)'}},'مکالمه‌ای یافت نشد.')
          ),
          h(Surface,null,
            h(SectionHead,{eyebrow:'UPCOMING',title:'اقدامات پیش‌رو',level:'h3'}),
            upTasks.length?h('div',{className:'list-group'},upTasks.map(function(t){
              return h('div',{key:t.id,className:'list-item',style:{padding:'12px',borderBottom:'1px solid var(--border-soft)'}},
                h('div',{style:{display:'flex',justifyContent:'space-between'}},
                  h('strong',null,text(t.title,'بدون عنوان')),
                  h(Chip,{tone:t.state==='TODO'?'neutral':'primary'},t.state)
                ),
                h('div',{style:{fontSize:'11px',color:'var(--text-soft)',marginTop:'4px'}},'مهلت: '+(t.due_at_utc?formatDate(t.due_at_utc):'نامشخص'))
              );
            })):h('p',{style:{color:'var(--text-soft)'}},'اقدامی یافت نشد.')
          )
        )
      );
    }

    renderWorkspaces(){
      var dash=this.state.dashboard||{};
      var metrics=dash;
      var projects=this.state.projects||[];
      var people=this.state.people||[];

      return h('div',{className:'page-shell workspace-page'},
        h('div',{className:'page-title'},
          h('div',null,h('span',{className:'eyebrow'},'WORKSPACE & DOMAIN HUB'),h('h1',null,'فضای کار و پروژه‌ها'),h('p',null,'مدیریت پروژه‌ها، مخاطبین، متادیتا و سلامت کلی فضای کاری.')),
          h(Chip,{tone:'primary',dot:true,active:true},'V0.16.0')
        ),
        h('div',{className:'metric-grid'},
          h(Metric,{label:'پروژه‌های فعال',value:metrics.activeProjects||projects.length||0}),
          h(Metric,{label:'تسک‌های باز',value:metrics.openTasks||0}),
          h(Metric,{label:'تسک‌های معوق',value:metrics.overdueTasks||0,tone:metrics.overdueTasks>0?'danger':''}),
          h(Metric,{label:'مخاطبین / اعضا',value:metrics.totalPeople||people.length||0}),
          h(Metric,{label:'تصمیمات ثبت‌شده',value:metrics.decisionsCount||0}),
          h(Metric,{label:'کل جلسات این فضا',value:metrics.totalConversations||this.state.sessions.length||0})
        ),
        h('div',{className:'workspace-grid'},
          h(Surface,null,
            h(SectionHead,{eyebrow:'PROJECTS',title:'پروژه‌ها',subtitle:'پروژه‌های متصل به جلسات و اقدامات صوتی'}),
            h('form',{onSubmit:this.createWorkspaceProject.bind(this),style:{display:'flex',gap:'8px',marginBottom:'12px'}},
              h('input',{className:'modern-input',placeholder:'نام پروژه جدید...',value:this.state.newProjectName,onChange:function(e){this.setState({newProjectName:e.target.value});}.bind(this)}),
              h('input',{className:'modern-input',placeholder:'توضیحات اختیاری...',value:this.state.newProjectDesc,onChange:function(e){this.setState({newProjectDesc:e.target.value});}.bind(this)}),
              h(Button,{variant:'solid',tone:'primary',type:'submit'},'افزودن پروژه')
            ),
            projects.length?h('div',{className:'workspace-cards-grid'},projects.map(function(p){
              return h('div',{key:p.id,className:'project-card'},
                h('div',{className:'project-card-header'},
                  h('strong',null,p.name),
                  h('span',{className:'color-badge '+text(p.colorToken,'blue')})
                ),
                h('p',{style:{fontSize:'11px',color:'var(--text-soft)'}},p.description||'بدون توضیح'),
                h('div',{style:{fontSize:'9px',color:'var(--muted)',marginTop:'6px'}},'وضعیت: '+text(p.status,'ACTIVE')),
                h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openEntityEditor('project',p);}.bind(this)},'ویرایش / حذف')
              );
            },this)):h(Empty,{symbol:'P',title:'پروژه‌ای ثبت نشده است'})
          ),
          h(Surface,null,
            h(SectionHead,{eyebrow:'PEOPLE & DIRECTORY',title:'مخاطبین و تیم',subtitle:'افراد حاضر در جلسات و مسئولین اقدامات'}),
            h('form',{onSubmit:this.createWorkspacePerson.bind(this),style:{display:'grid',gap:'8px',marginBottom:'12px'}},
              h('input',{className:'modern-input',placeholder:'نام و نام خانوادگی...',value:this.state.newPersonName,onChange:function(e){this.setState({newPersonName:e.target.value});}.bind(this)}),
              h('input',{className:'modern-input',placeholder:'سمت / نقش...',value:this.state.newPersonRole,onChange:function(e){this.setState({newPersonRole:e.target.value});}.bind(this)}),
              h('input',{className:'modern-input ltr',placeholder:'ایمیل...',value:this.state.newPersonEmail,onChange:function(e){this.setState({newPersonEmail:e.target.value});}.bind(this)}),
              h(Button,{variant:'soft',tone:'neutral',type:'submit'},'افزودن مخاطب')
            ),
            people.length?h('div',{style:{display:'grid',gap:'8px'}},people.map(function(person){
              return h('div',{key:person.id,className:'person-card'},
                h('strong',null,person.displayName),
                h('span',{style:{fontSize:'10px',color:'var(--text-soft)'}},(person.roleTitle||'عضو')+(person.email?' · '+person.email:'')),
                h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openEntityEditor('person',person);}.bind(this)},'ویرایش / حذف')
              );
            },this)):h(Empty,{symbol:'U',title:'مخاطبی اضافه نشده است'})
          )
        )
      );
    }

    renderActions(){
      var tasks=this.state.tasks||[];
      var dash=this.state.dashboard||{};
      var insights=dash.recentDecisions||[];

      var todoTasks=tasks.filter(function(t){return t.state==='TODO'||!t.state;});
      var inProgressTasks=tasks.filter(function(t){return t.state==='IN_PROGRESS';});
      var doneTasks=tasks.filter(function(t){return t.state==='DONE';});

      return h('div',{className:'page-shell actions-page'},
        h('div',{className:'page-title'},
          h('div',null,h('span',{className:'eyebrow'},'ACTION CENTER & TASK MACHINE'),h('h1',null,'اقدامات و مصوبات'),h('p',null,'مدیریت کارهای استخراج‌شده از جلسات و تثبیت تصمیم‌ها و مصوبات کلیدی.')),
          h(Chip,{tone:'success',dot:true,active:true},tasks.length+' TASK')
        ),
        h(Surface,{style:{marginBottom:'14px'}},
          h(SectionHead,{eyebrow:'QUICK TASK',title:'ثبت اقدام جدید',level:'h3'}),
          h('form',{onSubmit:this.createWorkspaceTask.bind(this),style:{display:'flex',gap:'8px'}},
            h('input',{className:'modern-input',style:{flex:2},placeholder:'عنوان تسک یا اقدام...',value:this.state.newTaskTitle,onChange:function(e){this.setState({newTaskTitle:e.target.value});}.bind(this)}),
            h('input',{className:'modern-input ltr',style:{flex:1},type:'date',value:this.state.newTaskDeadline,onChange:function(e){this.setState({newTaskDeadline:e.target.value});}.bind(this)}),
            h(Button,{variant:'solid',tone:'primary',type:'submit'},'ثبت تسک')
          )
        ),
        h('div',{className:'tasks-board'},
          h('div',{className:'tasks-column'},
            h('div',{className:'tasks-column-head'},h('strong',null,'در صف انجام (TODO)'),h(Chip,{tone:'neutral'},todoTasks.length)),
            h('div',{className:'tasks-list'},todoTasks.length?todoTasks.map(function(t){
              return h('div',{key:t.id,className:'task-card'},
                h('div',{className:'task-card-header'},h('strong',null,t.title),h(Chip,{tone:'warning'},'TODO')),
                t.dueAtUtc?h('div',{style:{fontSize:'9px',color:'var(--muted)'}},'مهلت: '+formatDate(t.dueAtUtc)):null,
                h('div',{style:{display:'flex',gap:'6px',marginTop:'6px'}},
                  h(Button,{variant:'soft',tone:'primary',onClick:function(){this.transitionTask(t.id,'IN_PROGRESS');}.bind(this)},'شروع'),
                  h(Button,{variant:'soft',tone:'success',onClick:function(){this.transitionTask(t.id,'DONE');}.bind(this)},'تکمیل'),
                  h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openEntityEditor('task',t);}.bind(this)},'ویرایش / حذف')
                )
              );
            },this):h(Empty,{symbol:'—',title:'تسکی در صف نیست'}))
          ),
          h('div',{className:'tasks-column'},
            h('div',{className:'tasks-column-head'},h('strong',null,'در حال انجام (IN PROGRESS)'),h(Chip,{tone:'primary'},inProgressTasks.length)),
            h('div',{className:'tasks-list'},inProgressTasks.length?inProgressTasks.map(function(t){
              return h('div',{key:t.id,className:'task-card'},
                h('div',{className:'task-card-header'},h('strong',null,t.title),h(Chip,{tone:'primary'},'ACTIVE')),
                t.dueAtUtc?h('div',{style:{fontSize:'9px',color:'var(--muted)'}},'مهلت: '+formatDate(t.dueAtUtc)):null,
                h('div',{style:{display:'flex',gap:'6px',marginTop:'6px'}},
                  h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.transitionTask(t.id,'TODO');}.bind(this)},'برگشت به صف'),
                  h(Button,{variant:'solid',tone:'success',onClick:function(){this.transitionTask(t.id,'DONE');}.bind(this)},'تکمیل شد'),
                  h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openEntityEditor('task',t);}.bind(this)},'ویرایش / حذف')
                )
              );
            },this):h(Empty,{symbol:'—',title:'موردی در حال اجرا نیست'}))
          ),
          h('div',{className:'tasks-column'},
            h('div',{className:'tasks-column-head'},h('strong',null,'انجام شده (DONE)'),h(Chip,{tone:'success'},doneTasks.length)),
            h('div',{className:'tasks-list'},doneTasks.length?doneTasks.map(function(t){
              return h('div',{key:t.id,className:'task-card'},
                h('div',{className:'task-card-header'},h('strong',null,t.title),h(Chip,{tone:'success'},'DONE')),
                t.completedAt?h('div',{style:{fontSize:'9px',color:'var(--muted)'}},'تکمیل در: '+formatDate(t.completedAt)):null,
                h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openEntityEditor('task',t);}.bind(this)},'ویرایش / حذف')
              );
            },this):h(Empty,{symbol:'✓',title:'هنوز تسکی انجام نشده'}))
          )
        ),
        insights.length?h(Surface,{style:{marginTop:'16px'}},
          h(SectionHead,{eyebrow:'CONFIRMED INSIGHTS',title:'مصوبات و نکات استخراج‌شده از جلسات',level:'h3'}),
          h('div',{className:'workspace-cards-grid'},insights.map(function(ins){
            return h('div',{key:ins.id,className:'insight-card'},
              h('div',{className:'insight-card-header'},
                h('strong',null,ins.title||'مصوبه جلسه'),
                h(Chip,{tone:'purple'},ins.insight_type||'DECISION')
              ),
              h('p',{style:{fontSize:'11px',lineHeight:'1.6'}},ins.content||ins.text||'—'),
              ins.quote?h('div',{className:'quote-box'},'«'+ins.quote+'»'):null
            );
          }))
        ):null
      );
    }

    /* Replaced by the decomposed Memory Center renderer below.
    renderMemory(){
      var settings=this.state.memorySettings||{},all=this.state.memories||[],tab=this.state.memoryTab,items=tab==='review'?(this.state.memoryReview||[]):all.slice();
      if(tab==='people')items=items.filter(function(x){return x.scopeType==='PERSON';});
      if(tab==='preferences')items=items.filter(function(x){return x.scopeType==='USER';});
      if(tab==='projects')items=items.filter(function(x){return x.scopeType==='PROJECT';});
      if(tab==='workspace')items=items.filter(function(x){return x.scopeType==='WORKSPACE';});
      if(this.state.memoryStatus)items=items.filter(function(x){return x.status===this.state.memoryStatus;},this);
      if(this.state.memoryQuery.trim()){var q=this.state.memoryQuery.trim();items=items.filter(function(x){return String(x.content||'').indexOf(q)>=0||String(x.canonicalKey||'').indexOf(q)>=0;});}
      var confirmed=all.filter(function(x){return x.status==='CONFIRMED';}).length,candidates=(this.state.memoryReview||[]).length,contradictions=(this.state.memoryContradictions||[]).filter(function(x){return x.state==='OPEN';}).length;
      var tabs=[['review','صندوق بررسی'],['people','افراد'],['preferences','ترجیحات'],['projects','پروژه‌ها'],['workspace','فضای کاری'],['all','همه'],['contradictions','تناقض‌ها']];
      return h('div',{className:'page-shell memory-center','data-product-view':'memory-center'},
        h('div',{className:'page-title'},h('div',null,h('span',{className:'eyebrow'},'PERSONAL MEMORY ENGINE'),h('h1',null,'مرکز حافظه'),h('p',null,'حافظه فقط با رضایت شما فعال می‌شود؛ هر مورد provenance، revision و تاریخچهٔ استفاده دارد.')),h(Chip,{tone:settings.enabled?'success':'neutral',dot:true,active:settings.enabled},settings.enabled?'حافظه فعال':'حافظه خاموش')),
        h('div',{className:'metric-grid'},h(Metric,{label:'تأییدشده',value:confirmed}),h(Metric,{label:'پیشنهاد بررسی',value:candidates}),h(Metric,{label:'تناقض باز',value:contradictions,tone:contradictions?'danger':''}),h(Metric,{label:'بودجه آیتم',value:settings.contextBudgetItems||0}),h(Metric,{label:'بودجه نویسه',value:settings.contextBudgetChars||0}),h(Metric,{label:'حساس',value:settings.sensitiveMemoryEnabled?'OPT-IN':'خاموش'})),
        h(Surface,{className:'memory-consent-card'},h(SectionHead,{eyebrow:'CONSENT & PRIVACY',title:'کنترل حافظه',subtitle:'خاموش‌کردن، extraction و injection را فوراً متوقف می‌کند؛ دادهٔ موجود تا حذف شما قابل مشاهده و export می‌ماند.'}),h('div',{className:'memory-control-row'},settings.enabled?h(Button,{variant:'solid',tone:'danger',loading:this.state.busyMemory,onClick:function(){this.configureMemory({enabled:false,candidateExtractionEnabled:false});}.bind(this)},'خاموش‌کردن کامل حافظه'):h(Button,{variant:'solid',tone:'success',loading:this.state.busyMemory,onClick:function(){this.configureMemory({enabled:true,consent:true,candidateExtractionEnabled:true});}.bind(this)},'فعال‌سازی با رضایت من'),h(ToggleButton,{label:'استخراج Candidate',active:Boolean(settings.candidateExtractionEnabled),disabled:!settings.enabled,onClick:function(){this.configureMemory({candidateExtractionEnabled:!settings.candidateExtractionEnabled});}.bind(this)}),h(ToggleButton,{label:'حافظه حساس (opt-in)',active:Boolean(settings.sensitiveMemoryEnabled),disabled:!settings.enabled,onClick:function(){this.configureMemory({sensitiveMemoryEnabled:!settings.sensitiveMemoryEnabled});}.bind(this)}),h(Field,{label:'حداکثر آیتم'},h('select',{className:'modern-select',value:String(settings.contextBudgetItems||6),disabled:!settings.enabled,onChange:function(e){this.configureMemory({contextBudgetItems:Number(e.target.value)});}.bind(this)},[3,6,10,15].map(function(x){return h('option',{key:x,value:String(x)},x);}))),h(Field,{label:'حداکثر نویسه'},h('select',{className:'modern-select',value:String(settings.contextBudgetChars||1800),disabled:!settings.enabled,onChange:function(e){this.configureMemory({contextBudgetChars:Number(e.target.value)});}.bind(this)},[800,1800,3000,6000].map(function(x){return h('option',{key:x,value:String(x)},x);})))),h('p',{className:'privacy-copy'},'هیچ Transcript یا Insight قدیمی خودکار CONFIRMED نمی‌شود. AI فقط Candidate می‌سازد و دادهٔ حساس را بدون opt-in نمی‌پذیرد.')),
        h('div',{className:'memory-toolbar'},h('div',{className:'memory-tabs'},tabs.map(function(x){return h(Button,{key:x[0],variant:tab===x[0]?'solid':'soft',tone:tab===x[0]?'primary':'neutral',onClick:function(){this.setState({memoryTab:x[0]});}.bind(this)},x[1]);},this)),h('div',{className:'memory-toolbar-actions'},h(Button,{variant:'soft',tone:'primary',loading:this.state.busyMemory,disabled:!settings.enabled||!settings.candidateExtractionEnabled||!this.state.sessionId,onClick:this.extractMemories.bind(this)},'استخراج از مکالمه انتخاب‌شده'),h(Button,{variant:'soft',tone:'neutral',onClick:this.exportMemories.bind(this)},'Export JSON + Markdown'))),
        tab==='contradictions'?h(Surface,null,h(SectionHead,{eyebrow:'CONTRADICTIONS',title:'حل تناقض بدون overwrite',level:'h3'}),(this.state.memoryContradictions||[]).length?h('div',{className:'memory-grid'},this.state.memoryContradictions.map(function(c){return h('article',{key:c.id,className:'memory-card contradiction-card'},h('div',{className:'memory-card-head'},h('strong',null,'تناقض '+shortId(c.id)),h(Chip,{tone:c.state==='OPEN'?'danger':'neutral'},c.state)),h('p',null,c.reason),c.state==='OPEN'?h('div',{className:'editor-actions'},h(Button,{variant:'soft',tone:'success',onClick:function(){this.resolveMemoryContradiction(c.id,'RESOLVED_LEFT');}.bind(this)},'انتخاب سمت چپ'),h(Button,{variant:'soft',tone:'primary',onClick:function(){this.resolveMemoryContradiction(c.id,'RESOLVED_RIGHT');}.bind(this)},'انتخاب سمت راست'),h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.resolveMemoryContradiction(c.id,'DISMISSED');}.bind(this)},'رد تناقض')):null);},this)):h(Empty,{symbol:'C',title:'تناقضی وجود ندارد'})):h(Surface,null,h(SectionHead,{eyebrow:'MEMORY LIBRARY',title:tab==='review'?'پیشنهادهای نیازمند تصمیم':'حافظه‌های قابل کنترل',level:'h3',action:h(Chip,{tone:'neutral'},items.length+' مورد')}),h('div',{className:'memory-filters'},h('input',{className:'modern-input',placeholder:'جست‌وجو در حافظه...',value:this.state.memoryQuery,onChange:function(e){this.setState({memoryQuery:e.target.value});}.bind(this)}),h('select',{className:'modern-select',value:this.state.memoryStatus,onChange:function(e){this.setState({memoryStatus:e.target.value});}.bind(this)},h('option',{value:''},'همه وضعیت‌ها'),['CANDIDATE','CONFIRMED','REJECTED','ARCHIVED','SUPERSEDED'].map(function(x){return h('option',{key:x,value:x},x);}))),items.length?h('div',{className:'memory-grid'},items.map(function(item){var ev=item.revisions&&item.revisions[0]&&item.revisions[0].evidence&&item.revisions[0].evidence[0];return h('article',{key:item.id,className:'memory-card'},h('div',{className:'memory-card-head'},h('div',null,h('strong',null,item.content),h('small',null,item.scopeType+':'+shortId(item.scopeId)+' · '+item.memoryType)),h(Chip,{tone:item.status==='CONFIRMED'?'success':item.status==='CANDIDATE'?'warning':'neutral'},item.status)),h('div',{className:'memory-meta'},h('span',null,'اطمینان '+Math.round(Number(item.confidence||0)*100)+'٪'),h('span',null,item.canonicalKey),h('span',null,item.sensitivity)),ev?h('blockquote',{className:'memory-evidence'},'«'+ev.exactQuote+'» · Turn '+shortId(ev.turnId)):null,h('div',{className:'editor-actions'},h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openMemoryDetail(item.id);}.bind(this)},'جزئیات / Revision / Usage'),item.status==='CANDIDATE'?h(Button,{variant:'solid',tone:'success',onClick:function(){this.memoryCommand(item.id,'confirm');}.bind(this)},'تأیید'):null,item.status==='CANDIDATE'?h(Button,{variant:'soft',tone:'danger',onClick:function(){this.memoryCommand(item.id,'reject');}.bind(this)},'رد'):null));},this)):h(Empty,{symbol:'M',title:settings.enabled?'موردی در این بخش نیست':'حافظه خاموش است',text:settings.enabled?'پس از مکالمه، استخراج Candidate را اجرا کن.':'برای شروع، رضایت روشن و قابل بازگشت خود را ثبت کن.'})))
      );
    }

    */

    renderMemoryCard(item){
      var ev=item.revisions&&item.revisions[0]&&item.revisions[0].evidence&&item.revisions[0].evidence[0];
      return h('article',{key:item.id,className:'memory-card'},
        h('div',{className:'memory-card-head'},h('div',null,h('strong',null,item.content),h('small',null,item.scopeType+':'+shortId(item.scopeId)+' · '+item.memoryType)),h(Chip,{tone:item.status==='CONFIRMED'?'success':item.status==='CANDIDATE'?'warning':'neutral'},item.status)),
        h('div',{className:'memory-meta'},h('span',null,'اطمینان '+Math.round(Number(item.confidence||0)*100)+'٪'),h('span',null,item.canonicalKey),h('span',null,item.sensitivity)),
        ev?h('blockquote',{className:'memory-evidence'},'«'+ev.exactQuote+'» · Turn '+shortId(ev.turnId)):null,
        h('div',{className:'editor-actions'},h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.openMemoryDetail(item.id);}.bind(this)},'جزئیات / Revision / Usage'),item.status==='CANDIDATE'?h(Button,{variant:'solid',tone:'success',onClick:function(){this.memoryCommand(item.id,'confirm');}.bind(this)},'تأیید'):null,item.status==='CANDIDATE'?h(Button,{variant:'soft',tone:'danger',onClick:function(){this.memoryCommand(item.id,'reject');}.bind(this)},'رد'):null)
      );
    }

    renderMemoryContradictions(){
      var rows=this.state.memoryContradictions||[];
      return h(Surface,null,h(SectionHead,{eyebrow:'CONTRADICTIONS',title:'حل تناقض بدون overwrite',level:'h3'}),rows.length?h('div',{className:'memory-grid'},rows.map(function(c){return h('article',{key:c.id,className:'memory-card contradiction-card'},h('div',{className:'memory-card-head'},h('strong',null,'تناقض '+shortId(c.id)),h(Chip,{tone:c.state==='OPEN'?'danger':'neutral'},c.state)),h('p',null,c.reason),c.state==='OPEN'?h('div',{className:'editor-actions'},h(Button,{variant:'soft',tone:'success',onClick:function(){this.resolveMemoryContradiction(c.id,'RESOLVED_LEFT');}.bind(this)},'انتخاب سمت چپ'),h(Button,{variant:'soft',tone:'primary',onClick:function(){this.resolveMemoryContradiction(c.id,'RESOLVED_RIGHT');}.bind(this)},'انتخاب سمت راست'),h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.resolveMemoryContradiction(c.id,'DISMISSED');}.bind(this)},'رد تناقض')):null);},this)):h(Empty,{symbol:'C',title:'تناقضی وجود ندارد'}));
    }

    renderMemory(){
      var settings=this.state.memorySettings||{},all=this.state.memories||[],tab=this.state.memoryTab;
      var items=tab==='review'?(this.state.memoryReview||[]):all.slice();
      if(tab==='people')items=items.filter(function(x){return x.scopeType==='PERSON';});
      if(tab==='preferences')items=items.filter(function(x){return x.scopeType==='USER';});
      if(tab==='projects')items=items.filter(function(x){return x.scopeType==='PROJECT';});
      if(tab==='workspace')items=items.filter(function(x){return x.scopeType==='WORKSPACE';});
      if(this.state.memoryStatus)items=items.filter(function(x){return x.status===this.state.memoryStatus;},this);
      if(this.state.memoryQuery.trim()){var q=this.state.memoryQuery.trim();items=items.filter(function(x){return String(x.content||'').indexOf(q)>=0||String(x.canonicalKey||'').indexOf(q)>=0;});}
      var confirmed=all.filter(function(x){return x.status==='CONFIRMED';}).length;
      var candidates=(this.state.memoryReview||[]).length;
      var contradictions=(this.state.memoryContradictions||[]).filter(function(x){return x.state==='OPEN';}).length;
      var tabs=[['review','صندوق بررسی'],['people','افراد'],['preferences','ترجیحات'],['projects','پروژه‌ها'],['workspace','فضای کاری'],['all','همه'],['contradictions','تناقض‌ها']];
      var backfill=(this.state.memoryBackfills||[])[0]||null;
      var consent=h(Surface,{className:'memory-consent-card'},
        h(SectionHead,{eyebrow:'CONSENT & PRIVACY',title:'کنترل حافظه',subtitle:'خاموش‌کردن، extraction و injection را فوراً متوقف می‌کند؛ دادهٔ موجود تا حذف شما قابل مشاهده و export می‌ماند.'}),
        h('div',{className:'memory-control-row'},
          settings.enabled?h(Button,{variant:'solid',tone:'danger',loading:this.state.busyMemory,onClick:function(){this.configureMemory({enabled:false,candidateExtractionEnabled:false});}.bind(this)},'خاموش‌کردن کامل حافظه'):h(Button,{variant:'solid',tone:'success',loading:this.state.busyMemory,onClick:function(){this.configureMemory({enabled:true,consent:true,candidateExtractionEnabled:true});}.bind(this)},'فعال‌سازی با رضایت من'),
          h(ToggleButton,{label:'استخراج Candidate',active:Boolean(settings.candidateExtractionEnabled),disabled:!settings.enabled,onClick:function(){this.configureMemory({candidateExtractionEnabled:!settings.candidateExtractionEnabled});}.bind(this)}),
          h(ToggleButton,{label:'حافظه حساس (opt-in)',active:Boolean(settings.sensitiveMemoryEnabled),disabled:!settings.enabled,onClick:function(){this.configureMemory({sensitiveMemoryEnabled:!settings.sensitiveMemoryEnabled});}.bind(this)}),
          h(Field,{label:'حداکثر آیتم'},h('select',{className:'modern-select',value:String(settings.contextBudgetItems||6),disabled:!settings.enabled,onChange:function(e){this.configureMemory({contextBudgetItems:Number(e.target.value)});}.bind(this)},[3,6,10,15].map(function(x){return h('option',{key:x,value:String(x)},x);}))),
          h(Field,{label:'حداکثر نویسه'},h('select',{className:'modern-select',value:String(settings.contextBudgetChars||1800),disabled:!settings.enabled,onChange:function(e){this.configureMemory({contextBudgetChars:Number(e.target.value)});}.bind(this)},[800,1800,3000,6000].map(function(x){return h('option',{key:x,value:String(x)},x);})))
        ),
        h('p',{className:'privacy-copy'},'هیچ Transcript یا Insight قدیمی خودکار CONFIRMED نمی‌شود. AI فقط Candidate می‌سازد و دادهٔ حساس را بدون opt-in نمی‌پذیرد.'),
        h('div',{className:'memory-backfill-row'},
          h('div',null,h('strong',null,'Backfill مکالمات قدیمی'),h('small',null,backfill?(backfill.state+' · '+backfill.processedCount+' از '+backfill.totalCount+' · '+backfill.candidateCount+' Candidate'):'فقط با opt-in؛ queued، restart-safe و batch محدود')),
          h('div',{className:'editor-actions'},
            !backfill||['COMPLETED','CANCELLED','FAILED'].includes(backfill.state)?h(Button,{variant:'soft',tone:'primary',disabled:!settings.enabled||!settings.candidateExtractionEnabled,onClick:this.startMemoryBackfill.bind(this)},'شروع Backfill'):null,
            backfill&&['QUEUED','RUNNING'].includes(backfill.state)?h(Button,{variant:'soft',tone:'warning',onClick:function(){this.controlMemoryBackfill(backfill.id,'pause');}.bind(this)},'توقف موقت'):null,
            backfill&&backfill.state==='PAUSED'?h(Button,{variant:'soft',tone:'success',onClick:function(){this.controlMemoryBackfill(backfill.id,'resume');}.bind(this)},'ادامه'):null,
            backfill&&!['COMPLETED','CANCELLED'].includes(backfill.state)?h(Button,{variant:'soft',tone:'neutral',onClick:function(){this.controlMemoryBackfill(backfill.id,'cancel');}.bind(this)},'لغو'):null
          )
        )
      );
      var toolbar=h('div',{className:'memory-toolbar'},h('div',{className:'memory-tabs'},tabs.map(function(x){return h(Button,{key:x[0],variant:tab===x[0]?'solid':'soft',tone:tab===x[0]?'primary':'neutral',onClick:function(){this.setState({memoryTab:x[0]});}.bind(this)},x[1]);},this)),h('div',{className:'memory-toolbar-actions'},h(Button,{variant:'soft',tone:'primary',loading:this.state.busyMemory,disabled:!settings.enabled||!settings.candidateExtractionEnabled||!this.state.sessionId,onClick:this.extractMemories.bind(this)},'استخراج از مکالمه انتخاب‌شده'),h(Button,{variant:'soft',tone:'neutral',onClick:this.exportMemories.bind(this)},'Export JSON + Markdown')));
      var library=h(Surface,null,h(SectionHead,{eyebrow:'MEMORY LIBRARY',title:tab==='review'?'پیشنهادهای نیازمند تصمیم':'حافظه‌های قابل کنترل',level:'h3',action:h(Chip,{tone:'neutral'},items.length+' مورد')}),h('div',{className:'memory-filters'},h('input',{className:'modern-input',placeholder:'جست‌وجو در حافظه...',value:this.state.memoryQuery,onChange:function(e){this.setState({memoryQuery:e.target.value});}.bind(this)}),h('select',{className:'modern-select',value:this.state.memoryStatus,onChange:function(e){this.setState({memoryStatus:e.target.value});}.bind(this)},h('option',{value:''},'همه وضعیت‌ها'),['CANDIDATE','CONFIRMED','REJECTED','ARCHIVED','SUPERSEDED'].map(function(x){return h('option',{key:x,value:x},x);}))),items.length?h('div',{className:'memory-grid'},items.map(this.renderMemoryCard.bind(this))):h(Empty,{symbol:'M',title:settings.enabled?'موردی در این بخش نیست':'حافظه خاموش است',text:settings.enabled?'پس از مکالمه، استخراج Candidate را اجرا کن.':'برای شروع، رضایت روشن و قابل بازگشت خود را ثبت کن.'}));
      return h('div',{className:'page-shell memory-center','data-product-view':'memory-center'},h('div',{className:'page-title'},h('div',null,h('span',{className:'eyebrow'},'PERSONAL MEMORY ENGINE'),h('h1',null,'مرکز حافظه'),h('p',null,'حافظه فقط با رضایت شما فعال می‌شود؛ هر مورد provenance، revision و تاریخچهٔ استفاده دارد.')),h(Chip,{tone:settings.enabled?'success':'neutral',dot:true,active:settings.enabled},settings.enabled?'حافظه فعال':'حافظه خاموش')),h('div',{className:'metric-grid'},h(Metric,{label:'تأییدشده',value:confirmed}),h(Metric,{label:'پیشنهاد بررسی',value:candidates}),h(Metric,{label:'تناقض باز',value:contradictions,tone:contradictions?'danger':''}),h(Metric,{label:'بودجه آیتم',value:settings.contextBudgetItems||0}),h(Metric,{label:'بودجه نویسه',value:settings.contextBudgetChars||0}),h(Metric,{label:'حساس',value:settings.sensitiveMemoryEnabled?'OPT-IN':'خاموش'})),consent,toolbar,tab==='contradictions'?this.renderMemoryContradictions():library);
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
      var content=this.state.view==='dashboard'?this.renderDashboard():this.state.view==='session'?this.renderSession():this.state.view==='workspaces'?this.renderWorkspaces():this.state.view==='actions'?this.renderActions():this.state.view==='memory'?this.renderMemory():this.state.view==='sources'?this.renderSources():this.state.view==='settings'?this.renderSettings():this.renderSystem();
      return h('div',{className:'auralis-app',dir:'rtl'},this.renderTop(),h('main',{className:'app-main'},content),this.renderNotice(),this.renderFooter(),this.renderOverlays());
    }
  }

  var rootNode=document.getElementById('root');
  var tree=h(ErrorBoundary,null,h(App));
  if(typeof ReactDOM.createRoot==='function')ReactDOM.createRoot(rootNode).render(tree);else ReactDOM.render(tree,rootNode);
})();
