import { nextCallState, canTransition, shouldPlayGreeting, normalizeAudioFormat, assertFrameMatchesFormat } from '../lib/call-state.ts';
let pass=0, fail=0;
const ok=(name,cond)=>{ if(cond){pass++;}else{fail++;} console.log((cond?'  ✅ ':'  ❌ ')+name); };
const throws=(name,fn)=>{ try{ fn(); fail++; console.log('  ❌ '+name+' (did not throw)'); }catch(e){ pass++; console.log('  ✅ '+name+' → '+e.message.slice(0,60)); } };

console.log('state machine:');
ok('new_call + greeting_started → greeting', nextCallState('new_call','greeting_started')==='greeting');
ok('greeting + greeting_done → listening', nextCallState('greeting','greeting_done')==='listening');
ok('listening + transcript_final → thinking', nextCallState('listening','transcript_final')==='thinking');
ok('thinking + response_started → speaking', nextCallState('thinking','response_started')==='speaking');
ok('BARGE-IN: speaking + interrupted → listening', nextCallState('speaking','interrupted')==='listening');
ok('BARGE-IN: speaking + speech_started → listening', nextCallState('speaking','speech_started')==='listening');
ok('thinking + interrupted → listening (cancel model)', nextCallState('thinking','interrupted')==='listening');
ok('transfer → handoff', nextCallState('speaking','transfer_requested')==='handoff');
ok('ended is terminal', nextCallState('ended','speech_started')===null);
ok('illegal: listening + response_started rejected', !canTransition('listening','response_started'));

console.log('greeting replay guard:');
ok('plays once on new call', shouldPlayGreeting({state:'new_call', greetingPlayed:false})===true);
ok('never replays after played', shouldPlayGreeting({state:'new_call', greetingPlayed:true})===false);
ok('never replays mid-call', shouldPlayGreeting({state:'listening', greetingPlayed:false})===false);

console.log('audio format:');
ok('mulaw 8000 ok', normalizeAudioFormat({encoding:'mulaw', sampleRate:8000}).bytesPerSample===1);
ok('PCMU alias → mulaw', normalizeAudioFormat({encoding:'PCMU', sampleRate:8000}).encoding==='mulaw');
ok('linear16 16000 ok', normalizeAudioFormat({encoding:'linear16', sampleRate:16000}).bytesPerSample===2);
throws('mulaw at 16000 rejected (the classic bug)', ()=>normalizeAudioFormat({encoding:'mulaw', sampleRate:16000}));
throws('unknown codec rejected', ()=>normalizeAudioFormat({encoding:'opus', sampleRate:48000}));
throws('missing sample rate rejected', ()=>normalizeAudioFormat({encoding:'mulaw'}));

console.log('frame checks:');
const f8 = normalizeAudioFormat({encoding:'mulaw', sampleRate:8000});
const f16 = normalizeAudioFormat({encoding:'linear16', sampleRate:16000});
assertFrameMatchesFormat(f8, 160); pass++; console.log('  ✅ 20ms mulaw frame (160B) accepted');
throws('odd frame for 16-bit PCM rejected', ()=>assertFrameMatchesFormat(f16, 321));
throws('absurdly long frame rejected (rate mismatch)', ()=>assertFrameMatchesFormat(f8, 40000));
console.log(`\n${pass} passed, ${fail} failed`);
