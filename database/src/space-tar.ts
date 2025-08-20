import ResourceRepository from './resource-repository.ts'
import tar from "tar-stream"
import { Readable, Writable } from 'stream'
import { blob } from 'stream/consumers'

export async function exportSpaceTar(
  resources: Pick<ResourceRepository, 'iterateSpaceNamedRepresentations'>,
  spaceUuid: string
): Promise<ReadableStream> {
  const pack = tar.pack()

  // pack should contain a directory named after the space uuid
  pack.entry({ name: spaceUuid, type: 'directory', })

  const repsInSpace = resources.iterateSpaceNamedRepresentations({
    space: spaceUuid,
  })

  // create entry files for each resource in space
  for await (const rep of repsInSpace) {
    const tarEntryName = `${spaceUuid}/${rep.blob.name}`

    pack.entry(
      { name: tarEntryName },
      // @todo dont load whole blob into memory
      Buffer.from(await rep.blob.arrayBuffer())
    );
  }
  pack.finalize()
  const t = new TransformStream();
  (Readable.toWeb(pack) as ReadableStream).pipeThrough(t);
  return t.readable
}

export function readFilesFromTar(stream: ReadableStream) {
  const extract = tar.extract()
  const files = new ReadableStream<File>({
    start(controller) {
      extract.on('entry', (header, stream, next) => {
        blob(stream).then(async blob => {
          switch (header.type) {
            case 'file':
              const name = header.name
              const nameParts = name.split('/').map(decodeURIComponent)
              const entryFileName = nameParts.at(-1)
              const entryFileNameCt = new URLSearchParams(entryFileName?.replace(/^[^?]+/, '')).get('ct') || undefined
              controller.enqueue(new File([await blob.arrayBuffer()], header.name, { type: entryFileNameCt }))
              break;
            case 'directory':
              break; // no need to make a File for directories
            default:
              console.warn('unsupported tar entry type', header.type, 'for entry', header.name)
              throw new Error(`Unsupported tar entry type: ${header.type} for entry ${header.name}`);
          }
          next()
        })
      })
      extract.on('finish', () => {
        controller.close()
      })
      stream.pipeTo(Writable.toWeb(extract))
    }
  })

  return files;
}
