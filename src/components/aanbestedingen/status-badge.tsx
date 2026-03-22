import { Badge } from '@/components/ui/badge';
import { AanbestedingStatus, STATUS_LABELS, STATUS_COLORS } from '@/types';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: AanbestedingStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border font-medium capitalize',
        STATUS_COLORS[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}
