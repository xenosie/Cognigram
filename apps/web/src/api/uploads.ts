import { useAuth } from '../store/auth'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type AttachmentKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'sticker'

export type Attachment = {
  id: string
  kind: AttachmentKind
  mime: string
  name: string
  size: number
  url: string
  width: number | null
  height: number | null
}

export type UploadProgress = {
  loaded: number
  total: number
}

/**
 * Upload a single file via multipart, with progress events. We use
 * `XMLHttpRequest` because `fetch()` doesn't expose upload progress.
 */
export function uploadFile(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<Attachment> {
  const token = useAuth.getState().accessToken
  if (!token) return Promise.reject(new Error('not authenticated'))

  const fd = new FormData()
  fd.append('file', file, file.name)

  return new Promise<Attachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.responseType = 'json'

    xhr.upload.addEventListener('progress', (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress({ loaded: e.loaded, total: e.total })
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as Attachment)
      } else {
        const message =
          (xhr.response && (xhr.response.message || xhr.response.error)) ||
          `Upload failed (${xhr.status})`
        reject(new Error(typeof message === 'string' ? message : 'Upload failed'))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    xhr.send(fd)
  })
}
