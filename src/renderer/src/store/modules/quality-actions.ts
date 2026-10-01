import { watch } from 'vue'
import type { QualityAction, QualityDraft, QualityEvidence, QualityInput } from '../../../../shared/quality-api'
import type { AppState } from '../state'
import { displayError } from '../../utils/formatters.ts'

export function emptyQualityForm(): QualityDraft {
  return {completion_id:0,reference:'',kind:'scrap',quantity:'1',loss_treatment:'',defect:'',action_note:'',warehouse_id:1,materials:[],reason:''}
}

export function createQualityActions(state: AppState, perform: (run: () => Promise<unknown>, message: string) => Promise<void>) {
  let owner=0, reads=0, details=0
  const can=(permission:string)=>state.user.value?.permissions.includes(permission)??false
  const available=()=>!!window.nexora && !state.connectionLost.value
  function clearQualityDetail():void {details++;state.qualityDetail.value=null}
  function invalidate():void {
    reads++;clearQualityDetail();state.qualityOverview.value=null;state.qualityError.value='';state.qualityLoading.value=false
  }
  watch(()=>`${state.user.value?.id}:${state.user.value?.permissions.join('|')}`,()=>{
    owner++;invalidate();state.qualityForm.value=emptyQualityForm();state.qualityEdit.value=null
  },{flush:'sync'})
  // 断线清除旧证据，但同账号尚未保存的处置输入与旧版本仍保留。
  watch(state.connectionLost,()=>{owner++;invalidate()},{flush:'sync'})
  async function loadQuality():Promise<boolean> {
    if(!can('quality.view') || !available() || state.qualityLoading.value)return false
    const ticket=++reads, session=owner;state.qualityLoading.value=true;state.qualityError.value='';clearQualityDetail()
    try {
      const result=await window.nexora!.callApi('qualityOverview',undefined)
      if(ticket!==reads || session!==owner || !can('quality.view'))return false
      state.qualityOverview.value=result;return true
    }catch(error){if(ticket===reads && session===owner){state.qualityOverview.value=null;state.qualityError.value=displayError(error)}return false}
    finally{if(ticket===reads && session===owner)state.qualityLoading.value=false}
  }
  async function loadQualityDetail(id:number):Promise<boolean> {
    if(!can('quality.view') || !available())return false
    clearQualityDetail();const ticket=details,session=owner;state.qualityError.value=''
    try {
      const result=await window.nexora!.callApi('qualityDetail',{id})
      if(ticket!==details || session!==owner || !can('quality.view'))return false
      state.qualityDetail.value=result;return true
    }catch(error){if(ticket===details && session===owner)state.qualityError.value=displayError(error);return false}
  }
  function startQualityDisposition(completionId:number):boolean {
    if(!can('quality.create') || !available())return false
    const source=state.qualityOverview.value?.cases.find(row=>row.id===completionId)
    if(!source || source.settled || Number(source.remaining_quantity)<=0)return false
    if(state.qualityEdit.value)state.qualityForm.value=emptyQualityForm()
    state.qualityEdit.value=null;state.qualityForm.value.completion_id=completionId
    state.qualityForm.value.quantity=source.remaining_quantity;state.qualityForm.value.defect ||= source.qc_note
    state.error.value='';clearQualityDetail();return true
  }
  async function editQualityDisposition(id:number):Promise<boolean> {
    if(!can('quality.create') || !await loadQualityDetail(id))return false
    const row=state.qualityDetail.value
    if(!row || !['draft','rejected'].includes(row.status))return false
    state.qualityForm.value={completion_id:row.completion_id,reference:row.reference,kind:row.kind,quantity:row.quantity,
      loss_treatment:row.loss_treatment,defect:row.defect,action_note:row.action_note,warehouse_id:row.warehouse_id,
      materials:row.materials.map(({material_id,quantity})=>({material_id,quantity})),reason:''}
    state.qualityEdit.value={id:row.id,version:row.version};state.error.value='';return true
  }
  async function write(permission:string,run:()=>Promise<QualityEvidence>,message:string):Promise<boolean> {
    if(!can(permission) || !available() || state.busy.value)return false
    const session=owner;let saved:QualityEvidence|null=null
    await perform(async()=>{
      if(session!==owner || !can(permission) || !available())return
      const result=await run();if(session===owner && can(permission))saved=result
    },message)
    if(!saved || session!==owner || !can(permission))return false
    const id=(saved as QualityEvidence).id
    await loadQuality();if(session===owner)await loadQualityDetail(id)
    return session===owner && can(permission)
  }
  async function saveQualityDisposition():Promise<boolean> {
    const form=state.qualityForm.value, edit=state.qualityEdit.value, session=owner
    if(form.kind==='scrap' && !['absorb','expense'].includes(form.loss_treatment)){
      state.error.value='请明确选择报废成本由合格品承担，或列为独立损失。';return false
    }
    const data:QualityInput & {id?:number;version?:number}={completion_id:form.completion_id,reference:form.reference,
      kind:form.kind,quantity:form.quantity,loss_treatment:form.kind==='rework'?'carry':form.loss_treatment as QualityInput['loss_treatment'],
      defect:form.defect,action_note:form.action_note,warehouse_id:form.kind==='rework'?form.warehouse_id:null,
      materials:form.kind==='rework'?form.materials.map(({material_id,quantity})=>({material_id,quantity})):[],reason:form.reason,...edit}
    const saved=await write('quality.create',()=>window.nexora!.callApi('saveQualityDisposition',data),'处置草稿已保存，须提交并独立审核。')
    if(saved && session===owner){state.qualityForm.value=emptyQualityForm();state.qualityEdit.value=null}
    return saved
  }
  return {loadQuality,loadQualityDetail,clearQualityDetail,startQualityDisposition,editQualityDisposition,saveQualityDisposition,
    changeQualityDisposition:(row:QualityEvidence,action:QualityAction,reason:string)=>write(
      ['approve','reject'].includes(action)?'quality.review':`quality.${action}`,
      ()=>window.nexora!.callApi('changeQualityDisposition',{id:row.id,version:row.version,action,reason}),
      action==='post'?'处置已确认；返工须下达工单、追加领料并重新检验，成本另行结算。':'处置阶段已更新，原单与更正证据保留。')}
}
