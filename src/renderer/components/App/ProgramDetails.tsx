import type { ProgramRecord } from '../../../shared/programTypes'

export function ProgramDetails({ program }: { program: ProgramRecord | null | undefined }) {
  if (!program) return null
  const status = program.state === 'working' ? 'Running'
    : program.state === 'done' ? 'Finished'
      : program.state === 'error' ? 'Error'
        : program.state === 'idle' ? 'Idle'
          : program.kind === 'permission' ? 'Waiting for approval'
            : program.kind === 'auth' ? 'Waiting for authentication' : 'Waiting for input'
  return <>
    <dt>Program</dt><dd>{program.app || 'Not reported'}</dd>
    <dt>Program status</dt><dd>{status}</dd>
    {program.title && <><dt>Task</dt><dd>{program.title}</dd></>}
    {program.message && <><dt>Message</dt><dd>{program.message}</dd></>}
    {'progress' in program && program.progress !== undefined && <><dt>Progress</dt><dd>{program.progress}%</dd></>}
  </>
}
