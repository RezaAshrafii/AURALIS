(function(){
  'use strict';
  var React=window.React;
  var h=React.createElement;

  var MODES=[
    {value:'study',label:'مطالعه',short:'Study',hint:'سؤال و درخواست شما از میکروفون به‌صورت خودکار پاسخ می‌گیرد؛ جمله‌های خبری فقط ثبت می‌شوند.'},
    {value:'oral_copilot',label:'کوپایلت شفاهی',short:'Oral Copilot',hint:'سؤال طرف مقابل از صدای سیستم خودکار پاسخ می‌گیرد؛ صدای شما به‌عنوان پاسخ شما ثبت می‌شود و دوباره جواب داده نمی‌شود.'},
    {value:'meeting',label:'جلسه',short:'Meeting',hint:'میکروفون و صدای سیستم مستقل ثبت می‌شوند؛ سؤال یا درخواست هر سمت می‌تواند پاسخ خودکار بگیرد.'},
    {value:'mock_oral_exam',label:'آزمون شفاهی',short:'Mock Exam',hint:'گفتار شما پاسخ آزمون است؛ برای جلوگیری از لو رفتن جواب، پاسخ خودکار روی Turnهای شما خاموش می‌ماند.'}
  ];

  var NAV_ITEMS=[
    {value:'session',label:'جلسه',caption:'Live'},
    {value:'sources',label:'منابع',caption:'Grounding'},
    {value:'settings',label:'تنظیمات',caption:'Control'},
    {value:'system',label:'وضعیت سیستم',caption:'Health'}
  ];

  var EVENT_LABELS={
    'session.started':'جلسه ایجاد شد','session.closed':'جلسه پایان یافت','session.settings_updated':'تنظیمات جلسه ذخیره شد',
    'native.capture.started':'ضبط صوت شروع شد','native.capture.stopped':'ضبط صوت متوقف شد','native.capture.channel_started':'کانال صوتی فعال شد',
    'native.audio.gap_detected':'شکاف صوتی ثبت شد','audio.chunk.closed':'بخش صوتی ذخیره شد','segment.frozen':'قطعهٔ گفتار تثبیت شد',
    'asr.started':'رونویسی شروع شد','asr.retry_scheduled':'تلاش مجدد ASR زمان‌بندی شد','asr.failed':'رونویسی ناموفق بود','asr.fallback_started':'Fallback محلی شروع شد','asr.fallback_completed':'Fallback محلی موفق بود','asr.fallback_failed':'Fallback محلی ناموفق بود',
    'transcript.partial':'متن موقت ثبت شد','transcript.stable':'متن پایدار ثبت شد','transcript.final':'متن نهایی ثبت شد','transcript.empty':'گفتاری تشخیص داده نشد','turn.committed':'Turn جدید ثبت شد',
    'turn.transcript_revised':'متن Turn بازبینی شد','answer.queued':'پاسخ در صف قرار گرفت','answer.completed':'پاسخ آماده شد',
    'answer.failed':'ساخت پاسخ ناموفق بود','answer.policy_skipped':'پاسخ طبق سیاست جلسه ارسال نشد','source.indexed':'منبع ایندکس شد',
    'runtime.quick_setup':'AI فعال شد','asr.config_changed':'تنظیمات ASR تغییر کرد','asr.local_config_changed':'تنظیم ASR محلی تغییر کرد','brain.runtime_config_changed':'تنظیمات Brain تغییر کرد'
  };

  function lsGet(key,fallback){try{var v=localStorage.getItem('auralis.ui.'+key);return v==null?fallback:JSON.parse(v);}catch(e){return fallback;}}
  function lsSet(key,value){try{localStorage.setItem('auralis.ui.'+key,JSON.stringify(value));}catch(e){}}
  function text(value,fallback){
    if(value===null||value===undefined||value==='')return fallback===undefined?'—':String(fallback);
    if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
    if(value instanceof Error)return value.message||'خطای نامشخص';
    try{return JSON.stringify(value);}catch(e){return String(value);}
  }
  function formatTime(value){try{return new Date(value).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}}
  function formatDate(value){try{return new Date(value).toLocaleDateString('fa-IR',{month:'short',day:'numeric'});}catch(e){return '—';}}
  function formatDuration(start,end){
    var a=new Date(start||0).getTime(),b=end?new Date(end).getTime():Date.now();
    if(!a||!Number.isFinite(a)||!Number.isFinite(b))return '—';
    var sec=Math.max(0,Math.round((b-a)/1000)),min=Math.floor(sec/60);sec%=60;
    return min?min+' دقیقه '+sec+' ثانیه':sec+' ثانیه';
  }
  function formatBytes(value){var n=Number(value||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(1)+' GB';}
  function shortId(value){return String(value||'').slice(0,8);}
  function roleLabel(role){return role==='system'?'طرف مقابل':role==='user'?'شما':'دستی';}
  function modeMeta(value){return MODES.filter(function(x){return x.value===value;})[0]||MODES[0];}
  function eventLabel(value){return EVENT_LABELS[value]||String(value||'رویداد سیستم').replaceAll('.',' · ');}
  function toneForState(value){
    var s=String(value||'').toUpperCase();
    if(/HEALTHY|READY|COMPLETED|TRANSCRIBED|FINAL|CAPTURING|ACTIVE|PASS/.test(s))return 'success';
    if(/FAILED|ERROR|AUTH_REQUIRED|REJECTED|GAP/.test(s))return 'danger';
    if(/RETRY|STARTING|STOPPING|WAIT|DEGRADED|RUNNING|VALIDATION|TRANSCRIBING|QUEUED|RATE/.test(s))return 'warning';
    if(/DISABLED|NOT_CONFIGURED|IDLE|CLOSED/.test(s))return 'neutral';
    return 'neutral';
  }

  function StatusDot(props){return h('span',{className:'status-dot '+(props.active?'active ':'')+(props.tone||'neutral'),'aria-hidden':'true'});}
  function Chip(props){return h('span',{className:'app-chip '+(props.tone||'neutral')+(props.active?' active':'')},props.dot?h(StatusDot,{active:props.active,tone:props.tone}):null,h('span',null,text(props.children,'')));}
  function Button(props){
    var c='app-btn '+(props.variant||'soft')+' '+(props.tone||'neutral')+(props.active?' is-active':'')+(props.loading?' is-loading':'')+(props.className?' '+props.className:'');
    return h('button',{type:'button',className:c,disabled:Boolean(props.disabled||props.loading),onClick:props.onClick,title:props.title,'aria-pressed':props.active===undefined?undefined:Boolean(props.active)},props.loading?h('span',{className:'spinner-dot','aria-hidden':'true'}):null,h('span',null,text(props.children,'')));
  }
  function ToggleButton(props){return h('button',{type:'button',className:'toggle-btn'+(props.active?' active':''),onClick:props.onClick,disabled:Boolean(props.disabled),'aria-pressed':Boolean(props.active)},h(StatusDot,{active:props.active,tone:props.active?'primary':'neutral'}),h('span',null,text(props.label,'')),props.detail?h('small',null,text(props.detail,'')):null);}
  function Surface(props){return h(props.as||'section',{className:'surface '+(props.className||'')},props.children);}
  function Field(props){return h('label',{className:'field '+(props.className||'')},h('span',{className:'field-label'},text(props.label,'')),props.help?h('span',{className:'field-help'},text(props.help,'')):null,props.children);}
  function Empty(props){return h('div',{className:'empty-state'},h('div',{className:'empty-symbol'},text(props.symbol,'·')),h('div',{className:'empty-title'},text(props.title,'هنوز چیزی اینجا نیست')),props.text?h('div',{className:'empty-text'},text(props.text,'')):null);}
  function SectionHead(props){return h('div',{className:'section-head'},h('div',null,props.eyebrow?h('span',{className:'eyebrow'},text(props.eyebrow,'')):null,h(props.level||'h2',null,text(props.title,'')),props.subtitle?h('p',{className:'section-subtitle'},text(props.subtitle,'')):null),props.action||null);}
  function Metric(props){return h('div',{className:'metric-card '+(props.tone||'')},h('span',null,text(props.label,'')),h('strong',null,text(props.value,'0')),props.note?h('small',null,text(props.note,'')):null);}
  function PipelineStage(props){return h('div',{className:'pipeline-stage '+(props.tone||'neutral')},h('div',{className:'stage-index'},text(props.index,'')),h('div',{className:'stage-copy'},h('strong',null,text(props.label,'')),h('span',null,text(props.detail,''))),h(Chip,{tone:props.tone||'neutral',dot:true,active:props.tone==='success'},text(props.state,'—')));}

  class ErrorBoundary extends React.Component{
    constructor(props){super(props);this.state={error:null};}
    static getDerivedStateFromError(error){return {error:error};}
    componentDidCatch(error,info){try{console.error('Auralis UI failure',error,info);}catch(e){}}
    render(){
      if(!this.state.error)return this.props.children;
      return h('main',{className:'fatal-shell',dir:'rtl'},h('section',{className:'fatal-card'},h('span',{className:'eyebrow'},'UI RECOVERY'),h('h1',null,'رابط کاربری متوقف شد'),h('p',null,'داده‌های صوتی و دفتر جلسه در backend باقی می‌مانند. صفحه را بازنشانی کن تا رابط دوباره متصل شود.'),h('code',null,text(this.state.error&&this.state.error.message,'خطای ناشناخته')),h(Button,{variant:'state',tone:'primary',onClick:function(){window.location.reload();}},'بارگذاری دوباره')));
    }
  }

  window.AuralisUI={h:h,MODES:MODES,NAV_ITEMS:NAV_ITEMS,lsGet:lsGet,lsSet:lsSet,text:text,formatTime:formatTime,formatDate:formatDate,formatDuration:formatDuration,formatBytes:formatBytes,shortId:shortId,roleLabel:roleLabel,modeMeta:modeMeta,eventLabel:eventLabel,toneForState:toneForState,StatusDot:StatusDot,Chip:Chip,Button:Button,ToggleButton:ToggleButton,Surface:Surface,Field:Field,Empty:Empty,SectionHead:SectionHead,Metric:Metric,PipelineStage:PipelineStage,ErrorBoundary:ErrorBoundary};
})();
