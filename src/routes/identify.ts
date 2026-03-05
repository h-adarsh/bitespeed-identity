import { Router, Request, Response } from "express";
import prisma from "../db/prisma";


const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { email, phoneNumber } = req.body;

  if (!email && !phoneNumber) {
    res.status(400).json({ error: "Email or phoneNumber is required" });
    return;
  }

  const matchingContacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(email ? [{ email }] : []),
        ...(phoneNumber ? [{ phoneNumber: String(phoneNumber) }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  if (matchingContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email: email || null,
        phoneNumber: phoneNumber ? String(phoneNumber) : null,
        linkPrecedence: "primary",
      },
    });

    res.status(200).json({
      contact: {
        primaryContatctId: newContact.id,
        emails: newContact.email ? [newContact.email] : [],
        phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
        secondaryContactIds: [],
      },
    });
    return;
  }

  const primaryContacts = matchingContacts.filter(
    (c) => c.linkPrecedence === "primary"
  );

  const allLinkedIds = matchingContacts
    .map((c) => (c.linkPrecedence === "primary" ? c.id : c.linkedId!))
    .filter((id): id is number => id !== null);

  const uniquePrimaryIds = [...new Set(allLinkedIds)];

  const allContacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      OR: [
        { id: { in: uniquePrimaryIds } },
        { linkedId: { in: uniquePrimaryIds } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const allPrimaries = allContacts.filter(
    (c) => c.linkPrecedence === "primary"
  );
  allPrimaries.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const truePrimary = allPrimaries[0]!;

  const otherPrimaries = allPrimaries.slice(1);
  if (otherPrimaries.length > 0) {
    await prisma.contact.updateMany({
      where: { id: { in: otherPrimaries.map((c) => c.id) } },
      data: {
        linkPrecedence: "secondary",
        linkedId: truePrimary.id,
        updatedAt: new Date(),
      },
    });
  }

  const emailExists = email
    ? allContacts.some((c) => c.email === email)
    : true;
  const phoneExists = phoneNumber
    ? allContacts.some((c) => c.phoneNumber === String(phoneNumber))
    : true;

  if (!emailExists || !phoneExists) {
    await prisma.contact.create({
      data: {
        email: email || null,
        phoneNumber: phoneNumber ? String(phoneNumber) : null,
        linkedId: truePrimary.id,
        linkPrecedence: "secondary",
      },
    });
  }

  const finalContacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      OR: [{ id: truePrimary.id }, { linkedId: truePrimary.id }],
    },
    orderBy: { createdAt: "asc" },
  });

  const emails = [
    ...new Set(
      finalContacts.map((c) => c.email).filter((e): e is string => e !== null)
    ),
  ];
  const phoneNumbers = [
    ...new Set(
      finalContacts
        .map((c) => c.phoneNumber)
        .filter((p): p is string => p !== null)
    ),
  ];
  const secondaryContactIds = finalContacts
    .filter((c) => c.linkPrecedence === "secondary")
    .map((c) => c.id);

  const primaryEmail = truePrimary.email;
  const primaryPhone = truePrimary.phoneNumber;

  const orderedEmails = primaryEmail
    ? [primaryEmail, ...emails.filter((e) => e !== primaryEmail)]
    : emails;

  const orderedPhones = primaryPhone
    ? [primaryPhone, ...phoneNumbers.filter((p) => p !== primaryPhone)]
    : phoneNumbers;

  res.status(200).json({
    contact: {
      primaryContatctId: truePrimary.id,
      emails: orderedEmails,
      phoneNumbers: orderedPhones,
      secondaryContactIds,
    },
  });
});

export default router;