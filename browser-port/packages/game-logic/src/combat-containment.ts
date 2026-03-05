interface ContainProfileLike {
  moduleType:
    | 'OPEN'
    | 'TRANSPORT'
    | 'OVERLORD'
    | 'HELIX'
    | 'PARACHUTE'
    | 'GARRISON'
    | 'TUNNEL'
    | 'CAVE'
    | 'HEAL'
    | 'INTERNET_HACK';
  passengersAllowedToFire: boolean;
  portableStructureTemplateNames?: readonly string[];
}

interface ContainedEntityLike {
  id: number;
  templateName: string;
  containProfile: ContainProfileLike | null;
  helixPortableRiderId: number | null;
}

export function isPassengerAllowedToFireFromContainingObject<TEntity extends ContainedEntityLike>(
  entity: TEntity,
  container: TEntity,
  resolveEntityKindOfSet: (entity: TEntity) => Set<string>,
  resolveEntityContainingObject: (entity: TEntity) => TEntity | null,
  entityHasObjectStatus: (entity: TEntity, statusName: string) => boolean,
): boolean {
  const kindOf = resolveEntityKindOfSet(entity);
  const isInfantry = kindOf.has('INFANTRY');
  const isPortableStructure = kindOf.has('PORTABLE_STRUCTURE');
  const visited = new Set<number>();

  const isAllowed = (currentContainer: TEntity): boolean => {
    if (visited.has(currentContainer.id)) {
      return false;
    }
    visited.add(currentContainer.id);

    const containProfile = currentContainer.containProfile;
    if (!containProfile) {
      return true;
    }

    const parent = resolveEntityContainingObject(currentContainer);
    const parentProfile = parent?.containProfile;
    const isParentOverlordStyle = parentProfile?.moduleType === 'OVERLORD' || parentProfile?.moduleType === 'HELIX';

    if (containProfile.moduleType === 'OPEN') {
      if (!containProfile.passengersAllowedToFire) {
        return false;
      }
      return parent ? isAllowed(parent) : true;
    }

    if (containProfile.moduleType === 'TRANSPORT') {
      if (!isInfantry) {
        return false;
      }
      if (parent && isParentOverlordStyle) {
        return isAllowed(parent);
      }
      return containProfile.passengersAllowedToFire;
    }

    if (containProfile.moduleType === 'OVERLORD') {
      if (!isInfantry && !isPortableStructure) {
        return false;
      }
      if (parent) {
        return false;
      }
      return containProfile.passengersAllowedToFire;
    }

    if (containProfile.moduleType === 'HELIX') {
      if (parent) {
        return false;
      }
      if (isPortableStructure) {
        const payloadTemplateNames = currentContainer.containProfile?.portableStructureTemplateNames;
        const templateName = entity.templateName.toUpperCase();
        if (payloadTemplateNames && payloadTemplateNames.length > 0 && !payloadTemplateNames.includes(templateName)) {
          return false;
        }
        return currentContainer.helixPortableRiderId === entity.id;
      }
      if (!isInfantry) {
        return false;
      }
      return containProfile.passengersAllowedToFire;
    }

    if (containProfile.moduleType === 'GARRISON') {
      if (entityHasObjectStatus(currentContainer, 'DISABLED_SUBDUED')) {
        return false;
      }
      return true;
    }

    // Source parity: TunnelContain — passengers cannot fire from tunnels.
    if (containProfile.moduleType === 'TUNNEL') {
      return false;
    }

    // PARACHUTE/CAVE/HEAL/INTERNET_HACK do not permit passenger firing.
    return false;
  };

  return isAllowed(container);
}
