import type { TeamDefinition } from '@hima/harness';
export const teamFixture:TeamDefinition={schema:'hima-team-definition/1',title:'Research team',
  members:[{id:'lead',role:'Research lead',runtime:'opencode',modelRef:'fixture-model',skills:[],instructions:'Use supplied evidence.',toolRefs:[],knowledgeRefs:[]}],
  leaderMemberId:'lead',collaboration:'Deliver the requested value with evidence.',
  delivery:{description:'A sourced answer',output:{version:'answer/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}}}};
