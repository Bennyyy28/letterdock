import { ConnectionForm } from '../../components/connection-form';
import { requireOwner } from '../../lib/owner';
export const dynamic='force-dynamic';
export default async function SetupPage(){await requireOwner();return <ConnectionForm/>;}
