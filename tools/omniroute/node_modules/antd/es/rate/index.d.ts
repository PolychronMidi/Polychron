import * as React from 'react';
import type { RateRef, RateProps as RcRateProps } from '@rc-component/rate/lib/Rate';
import type { SizeType } from '../config-provider/SizeContext';
import type { TooltipProps } from '../tooltip';
export interface RateProps extends RcRateProps {
    rootClassName?: string;
    tooltips?: (TooltipProps | string)[];
    size?: SizeType;
}
declare const Rate: React.ForwardRefExoticComponent<RateProps & React.RefAttributes<RateRef>>;
export default Rate;
