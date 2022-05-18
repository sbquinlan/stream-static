import statuses from 'statuses'

export class HttpError extends Error {
  public constructor(public status: number) {
    super();
    this.name = this.status >= 500 ? 'ServerError' : 'ClientError';
    this.message = statuses.message[this.status] ?? 'Unknown Error';
  }
}
export default function error(status: number) {
  return new HttpError(status)
}