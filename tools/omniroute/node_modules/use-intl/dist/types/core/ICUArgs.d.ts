import type { GetICUArgs, GetICUArgsOptions } from '@schummar/icu-type-parser';
type ICUArgs<Message extends string, Options extends GetICUArgsOptions> = string extends Message ? {} : GetICUArgs<Message, Options>;
export default ICUArgs;
